import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsOptional } from 'class-validator';

export class CrearRendicionDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  gastoIds: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  observaciones?: string;
}
