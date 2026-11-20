import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { UserResponseDto } from '../users/dto';
import { AdminUsersService } from './admin-users.service';
import { ListUsersQueryDto, PaginatedUsersDto, SetUserStatusDto } from './dto';

@ApiTags('admin')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Not an administrator' })
@Roles(Role.ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly admin: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'List users (paginated; filter by role/status; search)' })
  @ApiOkResponse({ type: PaginatedUsersDto })
  list(@Query() query: ListUsersQueryDto): Promise<PaginatedUsersDto> {
    return this.admin.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One user' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse()
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<UserResponseDto> {
    return this.admin.get(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Activate or deactivate a user (not yourself)' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ description: 'Own account' })
  @ApiNotFoundResponse()
  setStatus(
    @CurrentUser() admin: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetUserStatusDto,
  ): Promise<UserResponseDto> {
    return this.admin.setStatus(admin.id, id, dto.isActive);
  }
}
