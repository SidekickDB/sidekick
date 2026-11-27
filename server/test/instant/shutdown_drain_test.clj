(ns instant.shutdown-drain-test
  "SidekickDB: the shutdown drain, INSTANT_SHUTDOWN_DRAIN_SECONDS /
   SIDEKICK_SHUTDOWN_DRAIN_SECONDS."
  (:require
   [clojure.test :refer [deftest is testing]]
   [instant.config :as config]
   [instant.util.env :as env]))

(defmacro with-env [vars & body]
  `(with-redefs [env/getenv (partial env/lookup ~vars)]
     ~@body))

(deftest shutdown-drain-opts
  (testing "unset outside the self-hosted mode: upstream's drain applies"
    (with-env {}
      (is (nil? (config/shutdown-drain-opts))))
    (with-env {"INSTANT_RUNTIME_MODE" "default"
               "INSTANT_SHUTDOWN_DRAIN_SECONDS" " "}
      (is (nil? (config/shutdown-drain-opts)))))
  (testing "self-hosted drains for 20 s by default"
    (with-env {"INSTANT_RUNTIME_MODE" "self-hosted"}
      (is (= {:total-ms 20000 :max-gap-ms 1000}
             (config/shutdown-drain-opts)))))
  (testing "the variable sets it in any mode; the SIDEKICK_ name wins"
    (with-env {"INSTANT_SHUTDOWN_DRAIN_SECONDS" "45"}
      (is (= {:total-ms 45000 :max-gap-ms 1000}
             (config/shutdown-drain-opts))))
    (with-env {"INSTANT_RUNTIME_MODE" "self-hosted"
               "INSTANT_SHUTDOWN_DRAIN_SECONDS" "45"
               "SIDEKICK_SHUTDOWN_DRAIN_SECONDS" "5"}
      (is (= {:total-ms 5000 :max-gap-ms 1000}
             (config/shutdown-drain-opts))))
    (with-env {"SIDEKICK_SHUTDOWN_DRAIN_SECONDS" "0"}
      (is (= {:total-ms 0 :max-gap-ms 1000}
             (config/shutdown-drain-opts)))))
  (testing "an invalid value falls back to the default"
    (doseq [bad ["-1" "20s" "1.5"]]
      (with-env {"INSTANT_RUNTIME_MODE" "self-hosted"
                 "SIDEKICK_SHUTDOWN_DRAIN_SECONDS" bad}
        (is (= {:total-ms 20000 :max-gap-ms 1000}
               (config/shutdown-drain-opts))
            bad))
      (with-env {"SIDEKICK_SHUTDOWN_DRAIN_SECONDS" bad}
        (is (nil? (config/shutdown-drain-opts)) bad)))))
