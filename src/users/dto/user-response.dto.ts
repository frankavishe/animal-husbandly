import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Juma Hamisi' })
  fullName: string;

  @ApiProperty({ type: String, nullable: true, example: '+255712345678' })
  phone: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'juma@example.co.tz' })
  email: string | null;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;
}
