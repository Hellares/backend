import { IsNotEmpty, IsString } from 'class-validator';

export class OAuthLoginDto {
  @IsString()
  @IsNotEmpty()
  provider: string; // 'google', 'facebook', etc.

  @IsString()
  @IsNotEmpty()
  accessToken: string;
}