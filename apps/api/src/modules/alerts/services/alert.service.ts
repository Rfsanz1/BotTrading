import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IAlertRepository } from '../../../domain/interfaces';
import { AlertRepository } from '../repositories/alert.repository';
import {
  AlertReceivedEvent,
  AlertValidatedEvent,
  AlertProcessingStartedEvent,
  AlertProcessingFailedEvent,
} from '../../../domain/events';
import {
  AlertNotFoundException,
  WebhookValidationException,
  AlertProcessingFailedEvent as AlertProcessingFailedException,
} from '../../../domain/exceptions';
import { CreateAlertDto, WebhookPayloadDto } from '../dto/alert.dto';

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private readonly repository: IAlertRepository;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    alertRepository?: AlertRepository,
  ) {
    this.repository = alertRepository || new AlertRepository();
  }

  /**
   * Handle incoming webhook from TradingView
   */
  async handleWebhook(userId: string, payload: Record<string, any>, webhookSource: string): Promise<string> {
    try {
      // Step 1: Validate webhook format
      const validationResult = this.validateWebhookPayload(payload);
      if (!validationResult.isValid) {
        throw new WebhookValidationException('Webhook validation failed', validationResult.errors);
      }

      // Step 2: Create alert record
      const alert = await this.repository.create({
        userId,
        symbol: validationResult.parsedData.symbol,
        webhookSource,
        webhookPayload: payload,
        status: 'RECEIVED',
        receivedAt: new Date(),
      });

      // Step 3: Publish AlertReceivedEvent
      const alertReceivedEvent = new AlertReceivedEvent(
        alert.id,
        userId,
        alert.symbol,
        payload,
        webhookSource,
      );
      await this.eventEmitter.emitAsync('trading.alert.received', alertReceivedEvent);

      this.logger.log(`Alert received: ${alert.id} for symbol ${alert.symbol}`);
      return alert.id;
    } catch (error) {
      this.logger.error(`Failed to handle webhook: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Validate alert and update status
   */
  async validateAlert(alertId: string): Promise<void> {
    try {
      const alert = await this.repository.findById(alertId);
      if (!alert) {
        throw new AlertNotFoundException(alertId);
      }

      // Perform validation checks
      const validationResult = this.validateWebhookPayload(alert.webhookPayload || {});

      if (!validationResult.isValid) {
        // Update status to failed
        await this.repository.updateStatus(alertId, 'REJECTED');
        const event = new AlertValidatedEvent(
          alertId,
          alert.userId,
          alert.symbol,
          false,
          validationResult.errors,
        );
        await this.eventEmitter.emitAsync('trading.alert.validated', event);
        throw new WebhookValidationException('Alert validation failed', validationResult.errors);
      }

      // Update status to validated
      await this.repository.updateStatus(alertId, 'VALIDATED');

      // Publish validation event
      const event = new AlertValidatedEvent(alertId, alert.userId, alert.symbol, true);
      await this.eventEmitter.emitAsync('trading.alert.validated', event);

      this.logger.log(`Alert validated: ${alertId}`);
    } catch (error) {
      this.logger.error(`Failed to validate alert ${alertId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Start processing of alert
   */
  async startProcessing(alertId: string): Promise<void> {
    try {
      const alert = await this.repository.findById(alertId);
      if (!alert) {
        throw new AlertNotFoundException(alertId);
      }

      await this.repository.updateStatus(alertId, 'PROCESSING');

      const event = new AlertProcessingStartedEvent(alertId, alert.userId, alert.symbol);
      await this.eventEmitter.emitAsync('trading.alert.processing_started', event);

      this.logger.log(`Alert processing started: ${alertId}`);
    } catch (error) {
      this.logger.error(`Failed to start processing alert ${alertId}: ${error.message}`, error.stack);
      
      // Update alert status to failed
      try {
        await this.repository.updateStatus(alertId, 'REJECTED');
      } catch {}
      
      throw error;
    }
  }

  /**
   * Get alert by ID
   */
  async getAlert(alertId: string): Promise<any> {
    const alert = await this.repository.findById(alertId);
    if (!alert) {
      throw new AlertNotFoundException(alertId);
    }
    return alert;
  }

  /**
   * Get user's alerts
   */
  async getUserAlerts(userId: string, limit: number = 50, offset: number = 0): Promise<any[]> {
    return this.repository.findByUserId(userId, limit, offset);
  }

  /**
   * Get alerts by symbol
   */
  async getAlertsBySymbol(symbol: string, limit: number = 50): Promise<any[]> {
    return this.repository.findBySymbol(symbol, limit);
  }

  /**
   * Get alerts by status
   */
  async getAlertsByStatus(status: string, limit: number = 50): Promise<any[]> {
    return this.repository.findByStatus(status, limit);
  }

  /**
   * Update alert status
   */
  async updateAlertStatus(alertId: string, status: string): Promise<any> {
    const alert = await this.repository.findById(alertId);
    if (!alert) {
      throw new AlertNotFoundException(alertId);
    }

    const validStatuses = ['RECEIVED', 'VALIDATED', 'PROCESSING', 'ANALYZED', 'RECOMMENDED', 'EXECUTED', 'COMPLETED', 'REJECTED'];
    if (!validStatuses.includes(status)) {
      throw new WebhookValidationException(`Invalid status: ${status}`);
    }

    return this.repository.updateStatus(alertId, status);
  }

  /**
   * Validate webhook payload
   */
  private validateWebhookPayload(payload: Record<string, any>): {
    isValid: boolean;
    errors?: string[];
    parsedData?: Record<string, any>;
  } {
    const errors: string[] = [];

    // Basic validation - symbol is required
    if (!payload.symbol && !payload.message) {
      errors.push('Missing required field: symbol or message');
    }

    // Extract symbol from payload
    const symbol = payload.symbol || payload.message?.split(' ')[0];
    if (!symbol) {
      errors.push('Cannot extract symbol from payload');
    }

    if (errors.length > 0) {
      return { isValid: false, errors };
    }

    return {
      isValid: true,
      parsedData: {
        symbol,
        price: payload.price,
        message: payload.message,
      },
    };
  }
}
