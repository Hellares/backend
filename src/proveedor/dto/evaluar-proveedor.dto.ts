import { IsString, IsInt, Min, Max, IsOptional } from 'class-validator';

export class EvaluarProveedorDto {
  @IsString()
  proveedorId: string;

  @IsString()
  empresaId: string;

  // Criterios de evaluación (1-5)
  @IsInt()
  @Min(1)
  @Max(5)
  calidadProductos: number;

  @IsInt()
  @Min(1)
  @Max(5)
  cumplimientoPlazos: number;

  @IsInt()
  @Min(1)
  @Max(5)
  atencionServicio: number;

  @IsInt()
  @Min(1)
  @Max(5)
  preciosCompetitivos: number;

  @IsOptional()
  @IsString()
  comentarios?: string;

  @IsString()
  evaluadoPor: string;
}
