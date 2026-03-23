import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CreateTurnoDto } from './create-turno.dto';

export class UpdateTurnoDto extends PartialType(CreateTurnoDto) {
  @ApiProperty({
    description: 'Estado activo del turno',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
