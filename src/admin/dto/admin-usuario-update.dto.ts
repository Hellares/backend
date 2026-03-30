import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class AdminUsuarioUpdateDto {
  @IsBoolean()
  isActive: boolean;

  @IsOptional()
  @IsString()
  motivo?: string;
}
