import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class RechazarRendicionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  observaciones: string;
}
