import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ALL_ROLES, AuthUser, CurrentUser, Roles } from '../common/decorators';
import { UpdateProfileDto, UserResponseDto } from './dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Roles(...ALL_ROLES)
@Controller('users/me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'My profile' })
  @ApiOkResponse({ type: UserResponseDto })
  async getProfile(@CurrentUser() user: AuthUser): Promise<UserResponseDto> {
    return UsersService.toPublic(await this.users.getById(user.id));
  }

  @Patch()
  @ApiOperation({ summary: 'Update my name, phone or email' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ description: 'Validation error or last identifier removed' })
  @ApiConflictResponse({ description: 'Phone or email already registered' })
  async updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    return UsersService.toPublic(await this.users.updateProfile(user.id, dto));
  }
}
