/**
 * State Modules Index
 *
 * Exports all available state modules and provides
 * a convenience function to register all core modules.
 */

import { FileStateManager } from "../fileStateManager";
import { PlotStateModule } from "./plotStateModule";
import { DDAStateModule } from "./ddaStateModule";
import { AnnotationStateModule } from "./annotationStateModule";
import { FileNavigationStateModule } from "./fileNavigationStateModule";

export { PlotStateModule } from "./plotStateModule";
export { DDAStateModule } from "./ddaStateModule";
export { AnnotationStateModule } from "./annotationStateModule";
export { FileNavigationStateModule } from "./fileNavigationStateModule";
export type { FileNavigationState } from "./fileNavigationStateModule";

/**
 * Register all core state modules with the file state manager
 */
export function registerCoreModules(fileStateManager: FileStateManager): void {
  fileStateManager.registerModule(new PlotStateModule(), 10);
  fileStateManager.registerModule(new DDAStateModule(), 20);
  fileStateManager.registerModule(new AnnotationStateModule(), 30);
  fileStateManager.registerModule(new FileNavigationStateModule(), 40);
}
