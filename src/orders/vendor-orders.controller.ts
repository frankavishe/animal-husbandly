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
  OrderReasonDto,
  PaginatedVendorOrdersDto,
  VendorListOrdersQueryDto,
  VendorOrderDto,
} from './dto';
import { VendorOrdersService } from './vendor-orders.service';

const NOT_FOUND = 'You do not have a shop, or the order is not found';

@ApiTags('orders')
@ApiBearerAuth()
@Roles(Role.VENDOR)
@Controller('vendors/me/orders')
export class VendorOrdersController {
  constructor(private readonly orders: VendorOrdersService) {}

  @Get()
  @ApiOperation({ summary: "My shop's sub-orders, newest first (also while suspended)" })
  @ApiOkResponse({ type: PaginatedVendorOrdersDto })
  @ApiNotFoundResponse({ description: 'You do not have a shop' })
  list(
    @CurrentUser() user: AuthUser,
    @Query() q: VendorListOrdersQueryDto,
  ): Promise<PaginatedVendorOrdersDto> {
    return this.orders.list(user.id, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of my sub-orders with delivery details and history' })
  @ApiOkResponse({ type: VendorOrderDto })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VendorOrderDto> {
    return this.orders.get(user.id, id);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'PENDING → CONFIRMED' })
  @ApiOkResponse({ type: VendorOrderDto })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: 'Not PENDING' })
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VendorOrderDto> {
    return this.orders.confirm(user.id, id);
  }

  @Post(':id/dispatch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'CONFIRMED → DISPATCHED' })
  @ApiOkResponse({ type: VendorOrderDto })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: 'Not CONFIRMED' })
  dispatch(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VendorOrderDto> {
    return this.orders.dispatch(user.id, id);
  }

  @Post(':id/deliver')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'DISPATCHED → DELIVERED; records that the cash was collected' })
  @ApiOkResponse({ type: VendorOrderDto })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: 'Not DISPATCHED' })
  deliver(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VendorOrderDto> {
    return this.orders.deliver(user.id, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'PENDING → REJECTED with a reason; stock is returned' })
  @ApiOkResponse({ type: VendorOrderDto })
  @ApiBadRequestResponse({ description: 'Missing or too long reason' })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: 'Not PENDING' })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OrderReasonDto,
  ): Promise<VendorOrderDto> {
    return this.orders.reject(user.id, id, dto.reason);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'CONFIRMED → CANCELLED with a reason; stock is returned' })
  @ApiOkResponse({ type: VendorOrderDto })
  @ApiBadRequestResponse({ description: 'Missing or too long reason' })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  @ApiConflictResponse({ description: 'Not CONFIRMED' })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OrderReasonDto,
  ): Promise<VendorOrderDto> {
    return this.orders.cancel(user.id, id, dto.reason);
  }
}
