import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  BadRequestException,
  NotFoundException,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { TradingService } from './trading.service';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import {
  CreateOrderDTO,
  SubmitOrderDTO,
  CancelOrderDTO,
  RecordTradeDTO,
  CalculatePositionSizeDTO,
  SyncOrdersDTO,
  OpenPositionDTO,
  UpdateStopLossTakeProfitDTO,
  ClosePositionDTO,
  SyncBalancesDTO,
  GetBalanceHistoryDTO,
  OrderResponseDTO,
  PositionResponseDTO,
  BalanceResponseDTO,
  PnLMetricsResponseDTO,
  PositionMetricsResponseDTO,
  ErrorResponseDTO,
  SuccessResponseDTO,
} from './dto/trading.dto';

@ApiTags('Trading')
@Controller('api/trading')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TradingController {
  constructor(private readonly tradingService: TradingService) {}

  /**
   * Helper to safely extract userId from authenticated request
   */
  private getUserId(req: any): string {
    if (!req.user?.id) {
      throw new BadRequestException('User not authenticated properly');
    }
    return req.user.id;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: Order Management
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create trading order from recommendation
   * PHASE 1
   */
  @Post('orders/create')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create trading order from recommendation' })
  @ApiResponse({
    status: 201,
    description: 'Order created successfully',
    type: OrderResponseDTO,
  })
  @ApiResponse({ status: 400, description: 'Invalid order data', type: ErrorResponseDTO })
  async createOrder(
    @Body() body: CreateOrderDTO,
    @Request() req: any,
  ): Promise<SuccessResponseDTO<{ id: string }>> {
    try {
      const userId = this.getUserId(req);
      const orderId = await this.tradingService.createOrder(body as any);
      return {
        success: true,
        data: { id: orderId },
        message: 'Order created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to create order',
      );
    }
  }

  /**
   * Submit order to exchange
   * PHASE 1
   */
  @Post('orders/:orderId/submit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit order to exchange for execution' })
  @ApiParam({ name: 'orderId', description: 'Order ID' })
  @ApiResponse({
    status: 200,
    description: 'Order submitted successfully',
  })
  @ApiResponse({ status: 404, description: 'Order not found', type: ErrorResponseDTO })
  async submitToExchange(@Param('orderId') orderId: string): Promise<SuccessResponseDTO<any>> {
    try {
      const result = await this.tradingService.submitToExchange(orderId);
      return {
        success: result.success || true,
        data: result,
        message: 'Order submitted to exchange',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to submit order',
      );
    }
  }

  /**
   * Cancel order on exchange
   * PHASE 1
   */
  @Post('orders/:orderId/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel order on exchange' })
  @ApiParam({ name: 'orderId', description: 'Order ID' })
  @ApiResponse({
    status: 200,
    description: 'Order canceled successfully',
  })
  @ApiResponse({ status: 404, description: 'Order not found', type: ErrorResponseDTO })
  async cancelOrder(@Param('orderId') orderId: string): Promise<SuccessResponseDTO<any>> {
    try {
      const result = await this.tradingService.cancelOrder(orderId);
      return {
        success: result.success || true,
        data: result,
        message: 'Order canceled successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to cancel order',
      );
    }
  }

  /**
   * Get order details
   * PHASE 1
   */
  @Get('orders/:orderId')
  @ApiOperation({ summary: 'Get order details' })
  @ApiParam({ name: 'orderId', description: 'Order ID' })
  @ApiResponse({
    status: 200,
    description: 'Order retrieved',
    type: OrderResponseDTO,
  })
  @ApiResponse({ status: 404, description: 'Order not found', type: ErrorResponseDTO })
  async getOrder(@Param('orderId') orderId: string): Promise<SuccessResponseDTO<any>> {
    try {
      const order = await this.tradingService.getOrder(orderId);
      if (!order) {
        throw new NotFoundException(`Order ${orderId} not found`);
      }
      return {
        success: true,
        data: order,
        message: 'Order retrieved',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to get order',
      );
    }
  }

  /**
   * Record trade execution
   * PHASE 1
   */
  @Post('trades/record')
  @HttpCode(201)
  @ApiOperation({ summary: 'Record trade execution details' })
  @ApiResponse({
    status: 201,
    description: 'Trade recorded successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid trade data', type: ErrorResponseDTO })
  async recordTrade(@Body() body: RecordTradeDTO): Promise<SuccessResponseDTO<{ id: string }>> {
    try {
      const tradeId = await this.tradingService.recordTrade(body as any);
      return {
        success: true,
        data: { id: tradeId },
        message: 'Trade recorded successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to record trade',
      );
    }
  }

  /**
   * Calculate position size based on risk management
   * PHASE 1
   */
  @Post('position-size/calculate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Calculate position size based on risk parameters',
  })
  @ApiResponse({
    status: 200,
    description: 'Position size calculated',
  })
  async calculatePositionSize(
    @Body() body: CalculatePositionSizeDTO,
  ): Promise<SuccessResponseDTO<{ positionSize: number }>> {
    try {
      const result = await this.tradingService.calculatePositionSize({
        orderId: 'temp-id',
        entryPrice: body.entryPrice,
        stopLoss: body.stopLossPrice,
        accountBalance: body.accountBalance,
        riskPercentage: body.riskPercent,
      });
      return {
        success: true,
        data: { positionSize: result.quantity },
        message: 'Position size calculated',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to calculate position size',
      );
    }
  }

  /**
   * Sync open orders from exchange with database
   * PHASE 1
   */
  @Post('orders/sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Synchronize open orders with exchange' })
  @ApiResponse({
    status: 200,
    description: 'Orders synchronized',
  })
  async syncOrders(
    @Body() body: SyncOrdersDTO,
    @Request() req: any,
  ): Promise<SuccessResponseDTO<any>> {
    try {
      const userId = this.getUserId(req);
      await this.tradingService.reconcileOpenOrders(userId, body.exchange);
      return {
        success: true,
        data: { exchange: body.exchange },
        message: 'Orders synchronized with exchange',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to sync orders',
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: Position Management
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get all open positions
   * PHASE 2
   */
  @Get('positions/open')
  @ApiOperation({ summary: 'Get all open positions' })
  @ApiResponse({
    status: 200,
    description: 'Open positions retrieved',
    type: [PositionResponseDTO],
  })
  async getOpenPositions(@Request() req: any): Promise<SuccessResponseDTO<any[]>> {
    try {
      const userId = this.getUserId(req);
      const positions = await this.tradingService.getOpenPositions(userId);
      return {
        success: true,
        data: positions || [],
        message: `Retrieved ${(positions || []).length} open positions`,
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to get positions',
      );
    }
  }

  /**
   * Get all closed positions
   * PHASE 2
   */
  @Get('positions/closed')
  @ApiOperation({ summary: 'Get all closed positions' })
  @ApiResponse({
    status: 200,
    description: 'Closed positions retrieved',
    type: [PositionResponseDTO],
  })
  async getClosedPositions(@Request() req: any): Promise<SuccessResponseDTO<any[]>> {
    try {
      const userId = this.getUserId(req);
      const positions = await this.tradingService.getClosedPositions(userId);
      return {
        success: true,
        data: positions || [],
        message: `Retrieved ${(positions || []).length} closed positions`,
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to get positions',
      );
    }
  }

  /**
   * Get position metrics (P&L, status, etc.)
   * PHASE 2
   */
  @Get('positions/:positionId')
  @ApiOperation({ summary: 'Get position details and metrics' })
  @ApiParam({ name: 'positionId', description: 'Position ID' })
  @ApiResponse({
    status: 200,
    description: 'Position metrics retrieved',
    type: PositionMetricsResponseDTO,
  })
  async getPositionMetrics(
    @Param('positionId') positionId: string,
  ): Promise<SuccessResponseDTO<any>> {
    try {
      const metrics = await this.tradingService.getPositionMetrics(positionId);
      return {
        success: true,
        data: metrics,
        message: 'Position metrics retrieved',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to get position metrics',
      );
    }
  }

  /**
   * Update stop-loss and take-profit for position
   * PHASE 2
   */
  @Patch('positions/:positionId/exit-levels')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update stop-loss and take-profit levels' })
  @ApiParam({ name: 'positionId', description: 'Position ID' })
  @ApiResponse({
    status: 200,
    description: 'Exit levels updated',
  })
  async updateStopLossTakeProfit(
    @Param('positionId') positionId: string,
    @Body() body: UpdateStopLossTakeProfitDTO,
  ): Promise<SuccessResponseDTO<any>> {
    try {
      await this.tradingService.updateStopLossTakeProfit(
        positionId,
        body.stopLoss,
        body.takeProfit,
      );
      return {
        success: true,
        data: { positionId },
        message: 'Exit levels updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to update exit levels',
      );
    }
  }

  /**
   * Close position
   * PHASE 2
   */
  @Post('positions/:positionId/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Close a position' })
  @ApiParam({ name: 'positionId', description: 'Position ID' })
  @ApiResponse({
    status: 200,
    description: 'Position closed',
  })
  async closePosition(
    @Param('positionId') positionId: string,
    @Body() body: ClosePositionDTO,
  ): Promise<SuccessResponseDTO<any>> {
    try {
      await this.tradingService.positionService.closePosition(
        positionId,
        body.closingPrice,
        body.reason,
      );
      return {
        success: true,
        data: { positionId },
        message: 'Position closed successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to close position',
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: Balance Synchronization
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Sync balances from exchange
   * PHASE 2
   */
  @Post('balance/sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Synchronize account balances from exchange' })
  @ApiResponse({
    status: 200,
    description: 'Balances synchronized',
  })
  async syncBalances(
    @Body() body: SyncBalancesDTO,
    @Request() req: any,
  ): Promise<SuccessResponseDTO<any>> {
    try {
      const userId = this.getUserId(req);
      const result = await this.tradingService.syncUserBalances(userId, body.exchange);
      return {
        success: true,
        data: result,
        message: 'Balances synchronized successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to sync balances',
      );
    }
  }

  /**
   * Get current balances
   * PHASE 2
   */
  @Get('balance/current/:exchange')
  @ApiOperation({ summary: 'Get current account balances' })
  @ApiParam({ name: 'exchange', description: 'Exchange name (e.g., binance)' })
  @ApiResponse({
    status: 200,
    description: 'Current balances retrieved',
    type: [BalanceResponseDTO],
  })
  async getCurrentBalances(
    @Param('exchange') exchange: string,
    @Request() req: any,
  ): Promise<SuccessResponseDTO<any[]>> {
    try {
      const userId = this.getUserId(req);
      const balances = await this.tradingService.balanceSyncService.getCurrentBalances(
        userId,
        exchange,
      );
      return {
        success: true,
        data: balances || [],
        message: `Retrieved ${(balances || []).length} assets`,
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to get balances',
      );
    }
  }

  /**
   * Get balance history for asset
   * PHASE 2
   */
  @Get('balance/history/:exchange/:asset')
  @ApiOperation({ summary: 'Get balance history for specific asset' })
  @ApiParam({ name: 'exchange', description: 'Exchange name' })
  @ApiParam({ name: 'asset', description: 'Asset symbol (e.g., USDT, BTC)' })
  @ApiResponse({
    status: 200,
    description: 'Balance history retrieved',
    type: [BalanceResponseDTO],
  })
  async getBalanceHistory(
    @Param('exchange') exchange: string,
    @Param('asset') asset: string,
    @Request() req: any,
  ): Promise<SuccessResponseDTO<any[]>> {
    try {
      const userId = this.getUserId(req);
      const history = await this.tradingService.balanceSyncService.getBalanceHistory(
        userId,
        exchange,
        asset,
        100,
      );
      return {
        success: true,
        data: history || [],
        message: `Retrieved ${(history || []).length} balance records`,
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to get balance history',
      );
    }
  }

  /**
   * Detect balance changes
   * PHASE 2
   */
  @Get('balance/changes/:exchange')
  @ApiOperation({ summary: 'Detect significant balance changes' })
  @ApiParam({ name: 'exchange', description: 'Exchange name' })
  @ApiResponse({
    status: 200,
    description: 'Balance changes detected',
  })
  async detectBalanceChanges(
    @Param('exchange') exchange: string,
    @Request() req: any,
  ): Promise<SuccessResponseDTO<any[]>> {
    try {
      const userId = this.getUserId(req);
      const changes = await this.tradingService.balanceSyncService.detectBalanceChanges(
        userId,
        exchange,
        0.001, // 0.1% threshold
      );
      return {
        success: true,
        data: changes || [],
        message: `Detected ${(changes || []).length} significant changes`,
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to detect changes',
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: P&L Reporting
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get portfolio P&L metrics
   * PHASE 2
   */
  @Get('pnl/metrics')
  @ApiOperation({ summary: 'Get portfolio P&L metrics and statistics' })
  @ApiResponse({
    status: 200,
    description: 'P&L metrics retrieved',
    type: PnLMetricsResponseDTO,
  })
  async getPnLMetrics(@Request() req: any): Promise<SuccessResponseDTO<any>> {
    try {
      const userId = this.getUserId(req);
      const metrics = await this.tradingService.getPnLMetrics(userId);
      return {
        success: true,
        data: metrics,
        message: 'P&L metrics retrieved',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to get P&L metrics',
      );
    }
  }

  /**
   * Update trading statistics
   * PHASE 2
   */
  @Post('stats/update')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update trading statistics' })
  @ApiResponse({
    status: 200,
    description: 'Statistics updated',
  })
  async updateTradingStats(@Request() req: any): Promise<SuccessResponseDTO<any>> {
    try {
      const userId = this.getUserId(req);
      await this.tradingService.updateTradingStats(userId);
      return {
        success: true,
        data: { userId },
        message: 'Trading statistics updated',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to update statistics',
      );
    }
  }
}


