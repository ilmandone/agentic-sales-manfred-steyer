import { computed, Service, signal } from '@angular/core';
import { injectAgentStore } from '@copilotkit/angular';
import {
  Dashboard,
  DashboardItem,
  initialDashboard,
} from '@shared/dashboard-schema';
import { DASHBOARD_AGENT_ID } from '../../agents/dashboard/dashboard-agent';

const STORAGE_KEY = 'dashboard';

@Service()
export class DashboardStore {
  readonly agentStore = injectAgentStore(DASHBOARD_AGENT_ID);

  readonly state = computed(() => this.agentStore().state() as Dashboard);
  readonly items = computed(() => this.state().items);
  readonly hasSavedState = signal(localStorage.getItem(STORAGE_KEY) !== null);

  addItem(item: DashboardItem): void {
    const dashboard = this.state();
    const newDashboard: Dashboard = {
      items: [...dashboard.items, item],
    };

    this.agentStore().agent.setState(newDashboard);
  }
}
