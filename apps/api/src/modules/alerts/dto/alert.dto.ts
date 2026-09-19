import { IsString, IsOptional, IsUUID } from 'class-validator';

export class CreateAlertDto {
  @IsString()
  symbol: string;

  @IsString()
  @IsOptional()
  webhookSource?: string;

  @IsOptional()
  webhookPayload?: Record<string, any>;
}

export class UpdateAlertStatusDto {
  @IsString()
  status: string;
}

export class AlertResponseDto {
  id: string;
  userId: string;
  symbol: string;
  status: string;
  webhookSource?: string;
  receivedAt: Date;
  validatedAt?: Date;

  constructor(alert: any) {
    this.id = alert.id;
    this.userId = alert.userId;
    this.symbol = alert.symbol;
    this.status = alert.status;
    this.webhookSource = alert.webhookSource;
    this.receivedAt = alert.receivedAt;
    this.validatedAt = alert.validatedAt;
  }
}

export class WebhookPayloadDto {
  @IsString()
  symbol: string;

  @IsOptional()
  price?: number;

  @IsOptional()
  message?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}
