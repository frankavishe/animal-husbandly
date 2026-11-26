import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import {
  AdminListOrdersQueryDto,
  AdminOrderDto,
  OrderReasonDto,
  PaginatedAdminOrdersDto,
} from '../orders/dto';
import { OrdersAdminService } from '../orders/orders-admin.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly orders: OrdersAdminService) {}

  @Get()
  @ApiOperation({ summary: 'All orders, newest first, with filters' })
  @ApiOkResponse({ type: PaginatedAdminOrdersDto })
  @ApiBadRequestResponse({ description: 'Invalid filter, or from after to' })
  list(@Query() q: AdminListOrdersQueryDto): Promise<PaginatedAdminOrdersDto> {
    return this.orders.list(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Any order in full: customer, every sub-order and its history' })
  @ApiOkResponse({ type: AdminOrderDto })
  @ApiNotFoundResponse({ description: 'Order not found' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminOrderDto> {
    return this.orders.get(id);
  }

  @Post(':id/sub-orders/:subOrderId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel an undelivered sub-order with a reason',
    description: 'Stock is returned from PENDING and CONFIRMED, not from DISPATCHED.',
  })
  @ApiOkResponse({ type: AdminOrderDto })
  @ApiBadRequestResponse({ description: 'Missing or too long reason' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiConflictResponse({ description: 'DELIVERED, REJECTED or CANCELLED' })
  cancel(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('subOrderId', ParseUUIDPipe) subOrderId: string,
    @Body() dto: OrderReasonDto,
  ): Promise<AdminOrderDto> {
    return this.orders.cancelSubOrder(admin.id, id, subOrderId, dto.reason);
  }
}
