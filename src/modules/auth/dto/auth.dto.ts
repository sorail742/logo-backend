import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

/** Code TOTP (6 chiffres) ou code de secours (8 caractères, tiret facultatif). */
const TOTP_OR_BACKUP_CODE = /^(\s*\d{3}\s?\d{3}\s*|[0-9a-z]{4}-?[0-9a-z]{4})$/i;

export class RegisterDto {
  @ApiProperty({ example: 'aissatou@example.org' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({ example: 'Aïssatou Diallo' })
  @IsString()
  @Length(2, 120)
  fullName: string;

  @ApiPropertyOptional({ default: 'fr', enum: ['fr', 'en'] })
  @IsOptional()
  @Matches(/^(fr|en)$/)
  locale?: string;
}

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  password: string;

  @ApiPropertyOptional({
    description: 'Code TOTP à 6 chiffres, ou code de secours xxxx-xxxx, si la double authentification est active',
  })
  @IsOptional()
  @Matches(TOTP_OR_BACKUP_CODE)
  totpCode?: string;
}

export class GoogleLoginDto {
  @ApiProperty({ description: 'ID token renvoyé par Google Identity Services' })
  @IsString()
  idToken: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(TOTP_OR_BACKUP_CODE)
  totpCode?: string;
}

export class TokenDto {
  @ApiProperty()
  @IsString()
  token: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}

export class TotpCodeDto {
  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/)
  code: string;
}

export class OtpRequestDto {
  @ApiProperty({ example: '+224620000000' })
  @Matches(/^\+\d{8,15}$/)
  phone: string;
}

export class OtpVerifyDto extends OtpRequestDto {
  @ApiProperty()
  @Matches(/^\d{6}$/)
  code: string;
}
