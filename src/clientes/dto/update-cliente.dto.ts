import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateClienteDto } from './create-cliente.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsBoolean } from 'class-validator';

export class UpdateClienteDto extends PartialType(
  OmitType(CreateClienteDto, ['dni'] as const),
) {
  @ApiPropertyOptional({
    description: 'Estado activo del cliente en la empresa',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
