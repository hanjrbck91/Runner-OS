/** Wire the application services from an injected dependency set. */
import type { CoreDependencies } from '../ports/index.js';
import { DailyService } from './daily-service.js';
import { PlanService } from './plan-service.js';
import { AggregationService } from './aggregation-service.js';
import { TodayService } from './today-service.js';

export interface RunnerServices {
  readonly daily: DailyService;
  readonly plans: PlanService;
  readonly aggregation: AggregationService;
  readonly today: TodayService;
}

export function createServices(deps: CoreDependencies): RunnerServices {
  return {
    daily: new DailyService(deps),
    plans: new PlanService(deps),
    aggregation: new AggregationService(deps),
    today: new TodayService(deps),
  };
}
