import { seedLibrary } from "./services/library";
import { gc } from "./services/fonts";
import { fail } from "./services/ui";
App({
  onLaunch() {
    try {
      seedLibrary();
      gc();
    } catch (error) {
      fail(error);
    }
  },
});
