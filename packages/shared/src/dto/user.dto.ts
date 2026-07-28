import { RoleName } from '../enums';

export interface CreateUserDto {
  email:    string;
  password: string;
  name?:    string;
}

export interface UpdateUserDto {
  name?:     string;
  isActive?: boolean;
}

export interface AssignRoleDto {
  userId: string;
  role:   RoleName;
}

export interface UserResponseDto {
  id:        string;
  email:     string;
  name?:     string | null;
  roles:     RoleName[];
  isActive:  boolean;
  createdAt: Date;
}
