import { Injectable, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../redis/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { ConsultaDniResponseDto } from './dto/consulta-dni-response.dto';
import { ConsultaRucResponseDto } from './dto/consulta-ruc-response.dto';

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
}
