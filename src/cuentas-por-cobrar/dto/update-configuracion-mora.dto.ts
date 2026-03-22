import { IsBoolean, IsInt, IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateConfiguracionMoraDto {
  @IsOptional()
  @IsBoolean()
  moraHabilitada?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  porcentajeMoraDiario?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  moraMaximaPorcentaje?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  diasGraciaMora?: number;
}
