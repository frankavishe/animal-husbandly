import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  IsNormalizedEmail,
  IsPersonName,
  IsStrongPassword,
  IsTzPhone,
  Trim,
} from '../../common/validators';
import { UserResponseDto } from '../../users/dto/user-response.dto';

export class RegisterDto {
  @ApiProperty({ example: 'Juma Hamisi', minLength: 2, maxLength: 100 })
  @IsPersonName()
  fullName: string;

  @ApiPropertyOptional({
    example: '0712345678',
    description: 'Tanzanian mobile; stored as +255XXXXXXXXX',
  })
  @IsOptional()
  @IsTzPhone()
  phone?: string;

  @ApiPropertyOptional({ example: 'juma@example.co.tz' })
  @IsOptional()
  @IsNormalizedEmail()
  email?: string;

  @ApiProperty({
    example: 'Secret123',
    description: '≥ 8 chars, at least one letter and one digit',
  })
  @IsStrongPassword()
  password: string;
}

export class LoginDto {
  @ApiProperty({ example: '0712345678', description: 'Phone number or email' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  identifier: string;

  @ApiProperty({ example: 'Secret123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token from a previous sign-in or refresh' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  refreshToken: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword: string;

  @ApiProperty({ description: '≥ 8 chars, at least one letter and one digit' })
  @IsStrongPassword()
  newPassword: string;
}

export class AuthResponseDto {
  @ApiProperty({ description: 'JWT access token (Bearer)' })
  accessToken: string;

  @ApiProperty({ description: 'Single-use refresh token' })
  refreshToken: string;

  @ApiProperty({ example: 900, description: 'Access token lifetime in seconds' })
  expiresIn: number;

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;
}
