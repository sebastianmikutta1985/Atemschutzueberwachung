import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-impressum-page',
  imports: [CommonModule, RouterLink],
  templateUrl: './impressum.page.html'
})
export class ImpressumPage {}
