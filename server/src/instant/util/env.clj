(ns instant.util.env
  "Environment variables under their SidekickDB names.

   Every INSTANT_* variable can also be set as SIDEKICK_*, e.g.
   SIDEKICK_BACKEND_URL for INSTANT_BACKEND_URL. The SIDEKICK_ name wins when
   both are set. The source keeps the INSTANT_ names, so that it stays close
   to upstream; this namespace is the only place that knows about the alias."
  (:require [clojure.string :as string]))

(def ^:private old-prefix "INSTANT_")
(def ^:private new-prefix "SIDEKICK_")

(defn sidekick-name
  "The SIDEKICK_ name for an INSTANT_ variable, or nil for any other variable."
  [var-name]
  (when (string/starts-with? var-name old-prefix)
    (str new-prefix (subs var-name (count old-prefix)))))

(defn describe
  "How to name the variable in a message: the SIDEKICK_ name first, with the
   INSTANT_ name it replaces."
  [var-name]
  (if-let [new-name (sidekick-name var-name)]
    (str new-name " (or " var-name ")")
    var-name))

(defn lookup
  "The value of `var-name` in `env`, a map of variable names to values. For an
   INSTANT_ variable, the SIDEKICK_ name wins when it is set and not blank:
   compose files pass unset variables through as empty strings, so empty must
   mean unset."
  [env var-name]
  (let [new-value (some->> (sidekick-name var-name) (get env))]
    (if (string/blank? new-value)
      (get env var-name)
      new-value)))

(defn getenv
  "Like System/getenv, but INSTANT_ variables can also be set as SIDEKICK_."
  [var-name]
  (lookup (System/getenv) var-name))
