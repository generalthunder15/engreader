import { seedLibrary } from "./services/library";
import { gc } from "./services/fonts";
import { fail } from "./services/ui";
import { initialize } from "./services/learning";
App({
  onLaunch() {
    try {
      seedLibrary();
      initialize();
      gc();
    } catch (error) {
      fail(error);
    }
  },
});
