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
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { CheckoutService } from './checkout.service';
import {
  CancelSubOrderDto,
  CheckoutDto,
  CustomerListOrdersQueryDto,
  CustomerOrderDto,
  PaginatedCustomerOrdersDto,
} from './dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@Roles(Role.CUSTOMER, Role.VENDOR)
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly checkoutService: CheckoutService,
    private readonly orders: OrdersService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Check out the whole cart (cash on delivery)',
    description:
      'All-or-nothing. `lines` must match the cart and current prices exactly. Repeating a ' +
      '`submissionKey` returns the original order (201); reusing it with other data is a 409.',
  })
  @ApiCreatedResponse({ type: CustomerOrderDto })
  @ApiBadRequestResponse({ description: 'Invalid body or empty cart' })
  @ApiNotFoundResponse({ description: 'Address not found' })
  @ApiConflictResponse({
    description:
      'Submission key reused with different data; 10 open orders; total above 10,000,000,000; ' +
      'or `message: string[]` with one entry per problem line',
  })
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto): Promise<CustomerOrderDto> {
    return this.checkoutService.checkout(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'My orders, newest first, filterable by overall status' })
  @ApiOkResponse({ type: PaginatedCustomerOrdersDto })
  list(
    @CurrentUser() user: AuthUser,
    @Query() q: CustomerListOrdersQueryDto,
  ): Promise<PaginatedCustomerOrdersDto> {
    return this.orders.list(user.id, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of my orders with sub-orders, items and status history' })
  @ApiOkResponse({ type: CustomerOrderDto })
  @ApiNotFoundResponse({ description: 'Order not found' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerOrderDto> {
    return this.orders.get(user.id, id);
  }

  @Post(':id/sub-orders/:subOrderId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Cancel a shop's PENDING part of my order; stock is returned" })
  @ApiOkResponse({ type: CustomerOrderDto })
  @ApiBadRequestResponse({ description: 'Reason above 500 characters' })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiConflictResponse({ description: 'Not PENDING' })
  cancelSubOrder(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('subOrderId', ParseUUIDPipe) subOrderId: string,
    @Body() dto: CancelSubOrderDto,
  ): Promise<CustomerOrderDto> {
    return this.orders.cancelSubOrder(user.id, id, subOrderId, dto.reason);
  }
}
