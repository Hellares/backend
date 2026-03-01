import { ApiProperty } from '@nestjs/swagger';

export class ConsultaRucResponseDto {
  @ApiProperty({ example: '20552103816' })
  ruc: string;

  @ApiProperty({ example: 'AGROLIGHT PERU S.A.C.' })
  razonSocial: string;

  @ApiProperty({ example: 'SOCIEDAD ANONIMA CERRADA' })
  tipoContribuyente: string;

  @ApiProperty({ example: 'ACTIVO' })
  estado: string;

  @ApiProperty({ example: 'HABIDO' })
  condicion: string;

  @ApiProperty({ example: 'LIMA' })
  departamento: string;

  @ApiProperty({ example: 'LIMA' })
  provincia: string;

  @ApiProperty({ example: 'SANTA ANITA' })
  distrito: string;

  @ApiProperty({ example: 'PJ. JORGE BASADRE NRO. 158 URB. POP LA UNIVERSAL 2DA ET.' })
  direccion: string;

  @ApiProperty({ example: 'PJ. JORGE BASADRE NRO. 158 URB. POP LA UNIVERSAL 2DA ET., LIMA - LIMA - SANTA ANITA' })
  direccionCompleta: string;

  @ApiProperty({ example: '150137' })
  ubigeo: string;
}
