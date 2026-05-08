"use client";

import { useEffect } from "react";

function notifyUpdateAvailable() {
  window.dispatchEvent(new CustomEvent("pwa-update-available"));
}

export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let refreshing = false;

    const handleControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      notifyUpdateAvailable();
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          registration.addEventListener("updatefound", () => {
            const nextWorker = registration.installing;
            if (!nextWorker) return;

            nextWorker.addEventListener("statechange", () => {
              if (nextWorker.state === "installed" && navigator.serviceWorker.controller) {
                notifyUpdateAvailable();
              }
            });
          });
        })
        .catch(() => {
          // Service workers require HTTPS, localhost, or another secure context.
        });
    });

    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange,
      );
    };
  }, []);

  return null;
}
