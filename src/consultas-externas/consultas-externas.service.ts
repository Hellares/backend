import { Injectable, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../redis/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { ConsultaDniResponseDto } from './dto/consulta-dni-response.dto';
import { ConsultaRucResponseDto } from './dto/consulta-ruc-response.dto';
import { ConsultaLicenciaResponseDto } from './dto/consulta-licencia-response.dto';
import { ConsultaPlacaResponseDto } from './dto/consulta-placa-response.dto';
import { TipoCambioResponseDto } from './dto/tipo-cambio-response.dto';

@Injectable()
export class ConsultasExternasService {
  private readonly logger: AppLoggerService;
  private readonly apiUrl: string;
  private readonly apiToken: string;
  private readonly CACHE_TTL = 86400; // 24 horas en segundos

  constructor(
    private readonly configService: ConfigService,
    private readonly cache: CacheService,
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(ConsultasExternasService.name);
    this.apiUrl = this.configService.get<string>('FACTILIZA_API_URL', 'https://api.factiliza.com/v1');
    this.apiToken = this.configService.get<string>('FACTILIZA_API_TOKEN', '');
  }

  async consultarRuc(ruc: string): Promise<ConsultaRucResponseDto> {
    // Validar formato RUC
    if (!/^\d{11}$/.test(ruc)) {
      throw new BadRequestException('El RUC debe tener exactamente 11 dígitos numéricos');
    }

    // Verificar que el token esté configurado
    if (!this.apiToken) {
      throw new ServiceUnavailableException('El servicio de consulta RUC no está configurado. Contacte al administrador.');
    }

    // Intentar obtener de cache
    const cacheKey = `consulta:ruc:${ruc}`;

    return this.cache.getOrSet<ConsultaRucResponseDto>(
      cacheKey,
      async () => {
        this.logger.info('Consultando RUC en API externa', { ruc });

        try {
          const response = await fetch(`${this.apiUrl}/ruc/info/${ruc}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${this.apiToken}`,
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            this.logger.warn('Error en consulta RUC - HTTP error', { ruc, status: response.status });
            throw new BadRequestException(`No se pudo consultar el RUC ${ruc}. Verifique que sea un RUC válido.`);
          }

          const body = await response.json();

          if (!body.success || body.status !== 200 || !body.data) {
            this.logger.warn('Error en consulta RUC - API response invalid', { ruc, body });
            throw new BadRequestException(`No se encontraron datos para el RUC ${ruc}`);
          }

          const data = body.data;

          const result: ConsultaRucResponseDto = {
            ruc: data.numero,
            razonSocial: data.nombre_o_razon_social,
            tipoContribuyente: data.tipo_contribuyente,
            estado: data.estado,
            condicion: data.condicion,
            departamento: data.departamento,
            provincia: data.provincia,
            distrito: data.distrito,
            direccion: data.direccion,
            direccionCompleta: data.direccion_completa,
            ubigeo: data.ubigeo_sunat,
          };

          this.logger.info('Consulta RUC exitosa', { ruc, razonSocial: result.razonSocial, condicion: result.condicion });

          return result;
        } catch (error) {
          if (error instanceof BadRequestException) {
            throw error;
          }
          this.logger.error(`Error al consultar API Factiliza - RUC: ${ruc}`, error.stack);
          throw new ServiceUnavailableException('No se pudo conectar con el servicio de consulta SUNAT. Intente nuevamente.');
        }
      },
      this.CACHE_TTL,
    );
  }

  async consultarDni(dni: string): Promise<ConsultaDniResponseDto> {
    // Validar formato DNI
    if (!/^\d{8}$/.test(dni)) {
      throw new BadRequestException('El DNI debe tener exactamente 8 dígitos numéricos');
    }

    // Buscar primero en la base de datos interna
    const personaInterna = await this.prisma.persona.findUnique({
      where: { dni },
      include: {
        usuario: { select: { id: true } },
      },
    });

    if (personaInterna) {
      this.logger.info('DNI encontrado en base de datos interna', { dni });

      const apellidos = personaInterna.apellidos || '';
      const partes = apellidos.split(' ');
      const apellidoPaterno = partes[0] || '';
      const apellidoMaterno = partes.slice(1).join(' ') || '';

      const direccion = personaInterna.direccion || '';
      const departamento = personaInterna.departamento || '';
      const provincia = personaInterna.provincia || '';
      const distrito = personaInterna.distrito || '';

      const partesDir = [direccion, departamento, provincia, distrito].filter(Boolean);
      const direccionCompleta = partesDir.join(', ');

      return {
        dni: personaInterna.dni!,
        nombres: personaInterna.nombres || '',
        apellidoPaterno,
        apellidoMaterno,
        nombreCompleto: `${apellidoPaterno} ${apellidoMaterno}, ${personaInterna.nombres || ''}`.trim(),
        departamento,
        provincia,
        distrito,
        direccion,
        direccionCompleta,
        ubigeo: '',
        telefono: personaInterna.telefono || undefined,
        email: personaInterna.email || undefined,
        origen: 'INTERNO',
        existeEnSistema: true,
        personaId: personaInterna.id,
        tieneUsuario: !!personaInterna.usuario,
      };
    }

    // No existe internamente — verificar token para consulta externa
    if (!this.apiToken) {
      throw new ServiceUnavailableException('El servicio de consulta DNI no está configurado. Contacte al administrador.');
    }

    // Intentar obtener de cache o consultar RENIEC
    const cacheKey = `consulta:dni:${dni}`;

    return this.cache.getOrSet<ConsultaDniResponseDto>(
      cacheKey,
      async () => {
        this.logger.info('Consultando DNI en API externa', { dni });

        try {
          const response = await fetch(`${this.apiUrl}/dni/info/${dni}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${this.apiToken}`,
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            this.logger.warn('Error en consulta DNI - HTTP error', { dni, status: response.status });
            throw new BadRequestException(`No se pudo consultar el DNI ${dni}. Verifique que sea un DNI válido.`);
          }

          const body = await response.json();

          if (!body.success || body.status !== 200 || !body.data) {
            this.logger.warn('Error en consulta DNI - API response invalid', { dni, body });
            throw new BadRequestException(`No se encontraron datos para el DNI ${dni}`);
          }

          const data = body.data;

          const result: ConsultaDniResponseDto = {
            dni: data.numero,
            nombres: data.nombres,
            apellidoPaterno: data.apellido_paterno,
            apellidoMaterno: data.apellido_materno,
            nombreCompleto: data.nombre_completo,
            departamento: data.departamento ?? '',
            provincia: data.provincia ?? '',
            distrito: data.distrito ?? '',
            direccion: data.direccion ?? '',
            direccionCompleta: data.direccion_completa ?? '',
            ubigeo: data.ubigeo_sunat ?? '',
            origen: 'RENIEC',
            existeEnSistema: false,
          };

          this.logger.info('Consulta DNI exitosa', { dni, nombreCompleto: result.nombreCompleto });

          return result;
        } catch (error) {
          if (error instanceof BadRequestException) {
            throw error;
          }
          this.logger.error(`Error al consultar API Factiliza - DNI: ${dni}`, error.stack);
          throw new ServiceUnavailableException('No se pudo conectar con el servicio de consulta RENIEC. Intente nuevamente.');
        }
      },
      this.CACHE_TTL,
    );
  }

  async consultarTipoCambio(): Promise<TipoCambioResponseDto> {
    if (!this.apiToken) {
      throw new ServiceUnavailableException('El servicio de tipo de cambio no está configurado.');
    }

    // Cache por 4 horas (el tipo de cambio se actualiza 1 vez al día)
    const cacheKey = 'consulta:tipo-cambio';

    return this.cache.getOrSet<TipoCambioResponseDto>(
      cacheKey,
      async () => {
        this.logger.info('Consultando tipo de cambio en API externa');

        try {
          const { getTodayString } = require('../common/utils/date-utils');
          const hoy = getTodayString();
          const response = await fetch(`${this.apiUrl}/tipocambio/info/dia?fecha=${hoy}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${this.apiToken}`,
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            const errorBody = await response.text();
            this.logger.warn('Error en consulta tipo de cambio', { status: response.status, body: errorBody });
            throw new BadRequestException('No se pudo obtener el tipo de cambio del día.');
          }

          const body = await response.json();

          this.logger.debug('Respuesta API tipo de cambio', { body: JSON.stringify(body) });

          if (!body.data) {
            this.logger.warn('Respuesta inválida de tipo de cambio', { body });
            throw new BadRequestException('No se pudo obtener el tipo de cambio del día.');
          }

          const result: TipoCambioResponseDto = {
            fecha: body.data.fecha,
            compra: body.data.compra,
            venta: body.data.venta,
          };

          this.logger.info('Tipo de cambio obtenido', { fecha: result.fecha, compra: result.compra, venta: result.venta });

          return result;
        } catch (error) {
          if (error instanceof BadRequestException) {
            throw error;
          }
          this.logger.error('Error al consultar tipo de cambio', error.stack);
          throw new ServiceUnavailableException('No se pudo conectar con el servicio de tipo de cambio.');
        }
      },
      14400, // 4 horas
    );
  }

  async consultarLicencia(dni: string): Promise<ConsultaLicenciaResponseDto> {
    if (!/^\d{8}$/.test(dni)) {
      throw new BadRequestException('El DNI debe tener exactamente 8 dígitos numéricos');
    }

    if (!this.apiToken) {
      throw new ServiceUnavailableException('El servicio de consulta de licencia no está configurado.');
    }

    const cacheKey = `consulta:licencia:${dni}`;

    return this.cache.getOrSet<ConsultaLicenciaResponseDto>(
      cacheKey,
      async () => {
        this.logger.info('Consultando licencia de conducir en API externa', { dni });

        try {
          const response = await fetch(`${this.apiUrl}/licencia/info/${dni}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${this.apiToken}`,
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            throw new BadRequestException(`No se pudo consultar la licencia para DNI ${dni}`);
          }

          const body = await response.json();

          if (!body.data || body.status !== 200) {
            throw new BadRequestException(`No se encontraron datos de licencia para DNI ${dni}`);
          }

          const data = body.data;
          const lic = data.licencia || {};

          const result: ConsultaLicenciaResponseDto = {
            numeroDocumento: data.numero_documento,
            nombreCompleto: data.nombre_completo,
            licenciaNumero: lic.numero || '',
            licenciaCategoria: lic.categoria || '',
            licenciaFechaVencimiento: lic.fecha_vencimiento || '',
            licenciaEstado: lic.estado || '',
            licenciaRestricciones: lic.restricciones || '',
          };

          this.logger.info('Consulta licencia exitosa', { dni, licencia: result.licenciaNumero, estado: result.licenciaEstado });

          return result;
        } catch (error) {
          if (error instanceof BadRequestException) throw error;
          this.logger.error(`Error al consultar licencia - DNI: ${dni}`, error.stack);
          throw new ServiceUnavailableException('No se pudo conectar con el servicio de consulta de licencias.');
        }
      },
      this.CACHE_TTL,
    );
  }

  async consultarPlaca(placa: string): Promise<ConsultaPlacaResponseDto> {
    const placaLimpia = placa.replace(/[-\s]/g, '').toUpperCase();
    if (!/^[A-Z0-9]{5,8}$/.test(placaLimpia)) {
      throw new BadRequestException('Formato de placa inválido');
    }

    if (!this.apiToken) {
      throw new ServiceUnavailableException('El servicio de consulta de placa no está configurado.');
    }

    const cacheKey = `consulta:placa:${placaLimpia}`;

    return this.cache.getOrSet<ConsultaPlacaResponseDto>(
      cacheKey,
      async () => {
        this.logger.info('Consultando placa en API externa', { placa: placaLimpia });

        try {
          const response = await fetch(`${this.apiUrl}/placa/info/${placaLimpia}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${this.apiToken}`,
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            throw new BadRequestException(`No se encontraron datos para la placa ${placaLimpia}`);
          }

          const body = await response.json();

          if (!body.data || !body.success) {
            throw new BadRequestException(`No se encontraron datos para la placa ${placaLimpia}`);
          }

          const data = body.data;

          const result: ConsultaPlacaResponseDto = {
            placa: data.placa,
            marca: data.marca || '',
            modelo: data.modelo || '',
            serie: data.serie || '',
            color: data.color || '',
            motor: data.motor || '',
            vin: data.vin || '',
          };

          this.logger.info('Consulta placa exitosa', { placa: result.placa, marca: result.marca, modelo: result.modelo });

          return result;
        } catch (error) {
          if (error instanceof BadRequestException) throw error;
          this.logger.error(`Error al consultar placa: ${placaLimpia}`, error.stack);
          throw new ServiceUnavailableException('No se pudo conectar con el servicio de consulta de placas.');
        }
      },
      this.CACHE_TTL,
    );
  }
}
