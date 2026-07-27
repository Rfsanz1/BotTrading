import { Controller, Get, Post, Param, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { NotificationService } from './notification.service';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * Send alert
   */
  @Post('send-alert')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send Telegram alert' })
  @ApiResponse({ status: 200, description: 'Alert sent successfully' })
  async sendAlert(@Body() body: { userId: string; message: string; metadata?: Record<string, any> }): Promise<{ ok: boolean }> {
    await this.notificationService.sendAlert(body.userId, body.message, body.metadata);
    return { ok: true };
  }

  /**
   * Send notification
   */
  @Post('send')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send notification' })
  @ApiResponse({ status: 200, description: 'Notification sent' })
  async sendNotification(
    @Body() body: { userId: string; title: string; body: string; data?: Record<string, any> },
  ): Promise<{ ok: boolean }> {
    await this.notificationService.sendNotification(body.userId, body.title, body.body, body.data);
    return { ok: true };
  }

  /**
   * Get user notifications
   */
  @Get('user/:userId')
  @ApiOperation({ summary: 'Get user notifications' })
  @ApiResponse({ status: 200, description: 'Notifications retrieved' })
  async getUserNotifications(
    @Param('userId') userId: string,
  ): Promise<any[]> {
    return this.notificationService.getUserNotifications(userId);
  }

  /**
   * Mark notification as read
   */
  @Post(':id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark notification as read' })
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
  async markAsRead(@Param('id') id: string): Promise<{ ok: boolean }> {
    await this.notificationService.markAsRead(id);
    return { ok: true };
  }
}
