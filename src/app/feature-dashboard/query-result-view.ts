import { Component, input } from '@angular/core';
import { QueryResult } from '@shared/query-schema';
import { BarChart } from '../shared/charts/bar-chart';
import { PieChart } from '../shared/charts/pie-chart';
import { PivotTable } from '../shared/charts/pivot-table';

@Component({
  selector: 'app-query-result-view',
  imports: [BarChart, PieChart, PivotTable],
  template: `
    @let result = this.result();
    @if (result.kind === 'barChart') {
      <app-bar-chart [data]="result.data" />
    } @else if (result.kind === 'pieChart') {
      <app-pie-chart [data]="result.data" />
    } @else if (result.kind === 'pivotTable') {
      <app-pivot-table [data]="result.data" />
    } @else if (result.kind === 'split') {
      <div class="split-charts">
        @for (chart of result.charts; track $index) {
          <app-query-result-view [result]="chart" />
        }
      </div>
    }
  `,
})
export class QueryResultView {
  readonly result = input.required<QueryResult>();
}
