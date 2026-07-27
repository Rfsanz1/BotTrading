/**
 * Base class for all domain events.
 * Implements event sourcing pattern for tracking state changes.
 */
export abstract class BaseDomainEvent {
  readonly occurredAt: Date;
  readonly aggregateId: string;
  readonly aggregateType: string;

  constructor(aggregateId: string, aggregateType: string) {
    this.aggregateId = aggregateId;
    this.aggregateType = aggregateType;
    this.occurredAt = new Date();
  }

  abstract getEventName(): string;
  abstract getEventPayload(): Record<string, any>;
}
