export interface RegisterDto {
  email:    string;
  password: string;
  name?:    string;
}

export interface LoginDto {
  email:    string;
  password: string;
}

export interface RefreshTokenDto {
  refreshToken: string;
}

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword:     string;
}

export interface AuthTokensDto {
  accessToken:  string;
  refreshToken: string;
  expiresIn:    number;
}
