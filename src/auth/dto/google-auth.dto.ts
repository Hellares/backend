import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GoogleAuthDto {
  @ApiProperty({
    description: 'ID Token obtenido desde Google Sign-In en la app móvil',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjI...',
  })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}
