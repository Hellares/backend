import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class AprobarRendicionDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  observaciones?: string;
}
