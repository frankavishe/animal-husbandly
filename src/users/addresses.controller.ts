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
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ALL_ROLES, AuthUser, CurrentUser, Roles } from '../common/decorators';
import { AddressesService } from './addresses.service';
import { AddressResponseDto, CreateAddressDto, UpdateAddressDto } from './dto';

@ApiTags('addresses')
@ApiBearerAuth()
@Roles(...ALL_ROLES)
@Controller('users/me/addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  @ApiOperation({ summary: 'My delivery addresses (default first)' })
  @ApiOkResponse({ type: [AddressResponseDto] })
  list(@CurrentUser() user: AuthUser): Promise<AddressResponseDto[]> {
    return this.addresses.list(user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Add a delivery address (the first one becomes default)' })
  @ApiCreatedResponse({ type: AddressResponseDto })
  @ApiBadRequestResponse({ description: 'Validation error or district not in region' })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAddressDto,
  ): Promise<AddressResponseDto> {
    return this.addresses.create(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of my addresses' })
  @ApiOkResponse({ type: AddressResponseDto })
  @ApiNotFoundResponse()
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AddressResponseDto> {
    return this.addresses.get(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update one of my addresses' })
  @ApiOkResponse({ type: AddressResponseDto })
  @ApiNotFoundResponse()
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<AddressResponseDto> {
    return this.addresses.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete one of my addresses (promotes the newest remaining)' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.addresses.remove(user.id, id);
  }
}
