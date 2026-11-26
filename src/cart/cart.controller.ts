import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { CartService } from './cart.service';
import { AddCartItemDto, CartDto, SetCartItemDto } from './dto';

@ApiTags('cart')
@ApiBearerAuth()
@Roles(Role.CUSTOMER, Role.VENDOR)
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiOperation({ summary: 'My cart, grouped by shop, with flagged lines' })
  @ApiOkResponse({ type: CartDto })
  get(@CurrentUser() user: AuthUser): Promise<CartDto> {
    return this.cart.get(user.id);
  }

  @Delete()
  @ApiOperation({ summary: 'Remove every line' })
  @ApiOkResponse({ type: CartDto })
  clear(@CurrentUser() user: AuthUser): Promise<CartDto> {
    return this.cart.clear(user.id);
  }

  @Post('items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a listing (adds to an existing line); stock is not reserved' })
  @ApiOkResponse({ type: CartDto })
  @ApiBadRequestResponse({ description: 'Invalid listing id or quantity' })
  @ApiForbiddenResponse({ description: 'You cannot buy from your own shop' })
  @ApiNotFoundResponse({ description: 'Listing not found' })
  @ApiConflictResponse({ description: 'Out of stock, above stock, or 50 lines already' })
  add(@CurrentUser() user: AuthUser, @Body() dto: AddCartItemDto): Promise<CartDto> {
    return this.cart.add(user.id, dto);
  }

  @Patch('items/:listingId')
  @ApiOperation({ summary: "Replace a line's quantity" })
  @ApiOkResponse({ type: CartDto })
  @ApiBadRequestResponse({ description: 'Invalid quantity' })
  @ApiForbiddenResponse({ description: 'You cannot buy from your own shop' })
  @ApiNotFoundResponse({ description: 'Not in your cart, or listing not found' })
  @ApiConflictResponse({ description: 'Out of stock or above stock' })
  set(
    @CurrentUser() user: AuthUser,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() dto: SetCartItemDto,
  ): Promise<CartDto> {
    return this.cart.set(user.id, listingId, dto);
  }

  @Delete('items/:listingId')
  @ApiOperation({ summary: 'Remove a line' })
  @ApiOkResponse({ type: CartDto })
  @ApiNotFoundResponse({ description: 'Listing is not in your cart' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ): Promise<CartDto> {
    return this.cart.remove(user.id, listingId);
  }
}
