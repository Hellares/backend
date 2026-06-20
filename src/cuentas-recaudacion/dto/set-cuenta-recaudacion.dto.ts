import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class SetCuentaRecaudacionDto {
  @ApiProperty({ description: 'FK EmpresaBanco donde se recauda este método' })
  @IsString()
  @IsNotEmpty()
  bancoId: string;
}
