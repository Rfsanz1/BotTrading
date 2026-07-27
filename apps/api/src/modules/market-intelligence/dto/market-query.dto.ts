import { IsOptional, IsString } from 'class-validator';

export class MarketQueryDto {
  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  timeframe?: string;

  @IsOptional()
  @IsString()
  source?: string;
}
