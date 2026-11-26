import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Trim } from '../../common/validators';
import { OverallStatus } from '../order-status';

export class CustomerListOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OverallStatus, description: 'Overall order status' })
  @IsOptional()
  @IsEnum(OverallStatus)
  status?: OverallStatus;
}

export class CancelSubOrderDto {
  @ApiPropertyOptional({
    maxLength: 500,
    example: 'I ordered the wrong animal.',
    description: 'Optional; a blank reason is treated as none',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
