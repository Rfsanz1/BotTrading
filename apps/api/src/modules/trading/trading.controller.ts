import { Controller, Post, Get, Param, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { TradingService } from './trading.service';

@ApiTags('Trading')
@Controller('trading')
export class TradingController {
  constructor(private readonly tradingService: TradingService) {}

  /**
   * Create order from recommendation
   */
  @Post('orders/create')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create trading order from recommendation' })
  @ApiResponse({ status: 201, description: 'Order created successfully' })
  async createOrder(@Body() body: any): Promise<{ id: string; ok: boolean }> {
    const orderId = await this.tradingService.createOrder(body);
    return { id: orderId, ok: true };
  }

  /**
   * Calculate position size
   */
  @Post('position-size/calculate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Calculate position size based on risk' })
  @ApiResponse({ status: 200, description: 'Position size calculated' })
  async calculatePositionSize(@Body() body: any): Promise<any> {
    return this.tradingService.calculatePositionSize(body);
  }

  /**
   * Submit order to exchange
   */
  @Post('orders/:orderId/submit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit order to exchange' })
  @ApiResponse({ status: 200, description: 'Order submitted successfully' })
  async submitToExchange(@Param('orderId') orderId: string): Promise<any> {
    return this.tradingService.submitToExchange(orderId);
  }

  /**
   * Record trade
   */
  @Post('trades/record')
  @HttpCode(201)
  @ApiOperation({ summary: 'Record trade execution' })
  @ApiResponse({ status: 201, description: 'Trade recorded successfully' })
  async recordTrade(@Body() body: any): Promise<{ id: string; ok: boolean }> {
    const tradeId = await this.tradingService.recordTrade(body);
    return { id: tradeId, ok: true };
  }

  /**
   * Get order
   */
  @Get('orders/:orderId')
  @ApiOperation({ summary: 'Get order details' })
  @ApiResponse({ status: 200, description: 'Order retrieved' })
  async getOrder(@Param('orderId') orderId: string): Promise<any> {
    return this.tradingService.getOrder(orderId);
  }
}
