import { TipoDocumento, FormatoPapel } from '@prisma/client';
import { ConfiguracionDocumentosService } from './configuracion-documentos.service';
import type { UpdateConfiguracionDocumentosDto } from './dto/update-configuracion-documentos.dto';
import type { UpdatePlantillaDocumentoDto } from './dto/update-plantilla-documento.dto';

/**
 * CANDADO: todo campo del DTO tiene que llegar al `data` de Prisma.
 *
 * Los dos updates arman el `data` campo por campo (`...(dto.x !== undefined &&
 * {x: dto.x})`), que es deliberado —solo se toca lo que vino— pero falla EN
 * SILENCIO: un campo nuevo del DTO se valida, pasa el 200, y nunca se guarda.
 * Paso exactamente eso con `logoUrl` y `posicionLogo` de la plantilla: el
 * usuario guardaba, la pantalla decia que si, y el PDF seguia con el diseño
 * viejo.
 *
 * 🔑 Los objetos de abajo son `Required<Dto>`: agregar un campo al DTO ROMPE la
 * compilacion de este test hasta que se lo liste, y entonces la asercion
 * comprueba que ademas llegue a la base.
 */

const hacerServicio = () => {
  const update = jest.fn().mockResolvedValue({});
  const prisma: any = {
    configuracionDocumentos: {
      findUnique: jest.fn().mockResolvedValue({ id: 'cfg-1' }),
      update,
      create: jest.fn(),
    },
    plantillaDocumento: {
      findUnique: jest.fn().mockResolvedValue({ id: 'plt-1' }),
      update,
      create: jest.fn(),
    },
  };
  const logger: any = { info: jest.fn(), setContext: jest.fn(), error: jest.fn() };
  const service = new ConfiguracionDocumentosService(prisma, logger);
  return { service, update };
};

/** Las claves que el servicio le paso a Prisma. */
const clavesDelUpdate = (update: jest.Mock) =>
  Object.keys(update.mock.calls[0][0].data);

describe('ConfiguracionDocumentosService — el update no puede perder campos', () => {
  it('updateConfiguracion guarda TODOS los campos de la marca', async () => {
    const { service, update } = hacerServicio();

    const dto: Required<UpdateConfiguracionDocumentosDto> = {
      logoUrl: 'https://cdn/logo.png',
      nombreComercial: 'Mi Marca',
      colorPrimario: '#1565C0',
      colorSecundario: '#1E88E5',
      colorTexto: '#333333',
      textoPiePagina: 'Gracias por su preferencia',
      textoPieVenta: 'Cambios dentro de 7 dias',
      textoPieServicio: 'Garantia de 3 meses',
      mostrarPaginacion: false,
    };

    await service.updateConfiguracion('empresa-1', dto);

    const guardadas = clavesDelUpdate(update);
    for (const campo of Object.keys(dto)) {
      expect(guardadas).toContain(campo);
    }
  });

  it('updatePlantilla guarda TODOS los campos de la plantilla', async () => {
    const { service, update } = hacerServicio();

    const dto: Required<UpdatePlantillaDocumentoDto> = {
      formatoPapel: FormatoPapel.A4 as unknown as UpdatePlantillaDocumentoDto['formatoPapel'],
      margenSuperior: 12,
      margenInferior: 12,
      margenIzquierdo: 14,
      margenDerecho: 14,
      mostrarLogo: true,
      mostrarDatosEmpresa: true,
      mostrarDatosCliente: true,
      mostrarDetalles: true,
      mostrarTotales: true,
      mostrarObservaciones: false,
      mostrarCondiciones: false,
      mostrarFirma: true,
      mostrarCodigoQR: false,
      mostrarPiePagina: true,
      colorEncabezado: '#004A94',
      colorCuerpo: '#222222',
      logoUrl: 'https://cdn/logo-cotizacion.png',
      posicionLogo: 'IZQUIERDA',
      condicionesPorDefecto: '* Precios incluyen IGV / * Sujeto a stock',
    };

    await service.updatePlantilla('empresa-1', TipoDocumento.COTIZACION, dto);

    const guardadas = clavesDelUpdate(update);
    for (const campo of Object.keys(dto)) {
      expect(guardadas).toContain(campo);
    }
  });

  it('un campo que NO vino no se toca (el update es parcial a propósito)', async () => {
    const { service, update } = hacerServicio();

    await service.updatePlantilla('empresa-1', TipoDocumento.COTIZACION, {
      mostrarFirma: false,
    });

    // Pisar con undefined todo lo no enviado borraria la configuracion entera
    // en cada guardado parcial.
    expect(clavesDelUpdate(update)).toEqual(['mostrarFirma']);
  });
});
