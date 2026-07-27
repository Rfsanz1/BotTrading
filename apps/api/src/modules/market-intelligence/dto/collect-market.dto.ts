import { IsArray, IsOptional, IsString } from 'class-validator';

export class CollectMarketDto {
  @IsArray()
  @IsString({ each: true })
  symbols: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  timeframes?: string[];
}
