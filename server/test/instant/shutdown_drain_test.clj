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
  (testing "an invalid value throws, naming the variable"
    (doseq [bad ["-1" "20s" "1.5" "abc" "3601" "99999999999999999"]]
      (with-env {"INSTANT_RUNTIME_MODE" "self-hosted"
                 "SIDEKICK_SHUTDOWN_DRAIN_SECONDS" bad}
        (is (thrown-with-msg? clojure.lang.ExceptionInfo
                              #"SIDEKICK_SHUTDOWN_DRAIN_SECONDS"
                              (config/shutdown-drain-opts))
            bad)))))

(deftest parse-shutdown-drain-seconds
  (testing "unset or blank"
    (is (nil? (config/parse-shutdown-drain-seconds nil)))
    (is (nil? (config/parse-shutdown-drain-seconds "")))
    (is (nil? (config/parse-shutdown-drain-seconds "  "))))
  (testing "a whole number of seconds from 0 to 3600"
    (is (= 0 (config/parse-shutdown-drain-seconds "0")))
    (is (= 45 (config/parse-shutdown-drain-seconds " 45 ")))
    (is (= 3600 (config/parse-shutdown-drain-seconds "3600"))))
  (testing "anything else is rejected"
    (doseq [bad ["abc" "20s" "1.5" "+5" "-1" "3601" "10000"
                 "99999999999999999" "99999999999999999999"]]
      (is (thrown-with-msg? clojure.lang.ExceptionInfo
                            #"SIDEKICK_SHUTDOWN_DRAIN_SECONDS \(or INSTANT_SHUTDOWN_DRAIN_SECONDS\)"
                            (config/parse-shutdown-drain-seconds bad))
          bad))))

(deftest init-rejects-an-invalid-drain
  (with-env {"INSTANT_RUNTIME_MODE" "self-hosted"
             "SIDEKICK_SHUTDOWN_DRAIN_SECONDS" "abc"}
    (is (thrown-with-msg? clojure.lang.ExceptionInfo
                          #"SIDEKICK_SHUTDOWN_DRAIN_SECONDS"
                          (config/init)))))
