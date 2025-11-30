import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsInt, Min } from 'class-validator';
import { EntidadTipo, CategoriaArchivo } from '@prisma/client';

export class UploadArchivoDto {
  @ApiProperty({
    description: 'ID de la empresa',
    example: 'cmik3sg1x0001n701xfj8r4iz',
  })
  @IsString()
  empresaId: string;

  @ApiPropertyOptional({
    enum: EntidadTipo,
    description: 'Tipo de entidad a la que pertenece el archivo',
    example: 'PRODUCTO',
  })
  @IsOptional()
  @IsEnum(EntidadTipo)
  entidadTipo?: EntidadTipo;

  @ApiPropertyOptional({
    description: 'ID de la entidad relacionada',
    example: 'cmik3sg1x0001n701xfj8r4iz',
  })
  @IsOptional()
  @IsString()
  entidadId?: string;

  @ApiPropertyOptional({
    enum: CategoriaArchivo,
    description: 'Categoría del archivo',
    example: 'PRINCIPAL',
  })
  @IsOptional()
  @IsEnum(CategoriaArchivo)
  categoria?: CategoriaArchivo;

  @ApiPropertyOptional({
    description: 'Orden del archivo en galerías',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  orden?: number;
}

export class ArchivoResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  empresaId: string;

  @ApiProperty()
  nombreOriginal: string;

  @ApiProperty()
  url: string;

  @ApiProperty({ required: false })
  urlThumbnail?: string;

  @ApiProperty({ enum: ['IMAGEN', 'VIDEO', 'DOCUMENTO', 'PDF', 'EXCEL', 'WORD', 'AUDIO', 'COMPRIMIDO', 'OTRO'] })
  tipoArchivo: string;

  @ApiProperty()
  mimeType: string;

  @ApiProperty()
  extension: string;

  @ApiProperty({ required: false })
  entidadTipo?: string;

  @ApiProperty({ required: false })
  entidadId?: string;

  @ApiProperty({ required: false })
  categoria?: string;

  @ApiProperty()
  tamanoBytes: number;

  @ApiProperty({ required: false })
  ancho?: number;

  @ApiProperty({ required: false })
  alto?: number;

  @ApiProperty()
  creadoEn: Date;
}
