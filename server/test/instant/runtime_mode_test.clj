(ns instant.runtime-mode-test
  "The SidekickDB runtime mode: INSTANT_RUNTIME_MODE / SIDEKICK_RUNTIME_MODE."
  (:require
   [clojure.string :as string]
   [clojure.test :refer [deftest is testing]]
   [instant.config :as config]
   [instant.core :as core]
   [instant.reactive.sse :as sse]
   [instant.util.env :as env])
  (:import
   (java.security MessageDigest)))

(defmacro with-env [vars & body]
  `(with-redefs [env/getenv (partial env/lookup ~vars)]
     ~@body))

(deftest selecting-the-mode
  (testing "unset or blank means default"
    (with-env {}
      (is (nil? (config/runtime-mode-value)))
      (is (not (config/self-hosted?))))
    (with-env {"INSTANT_RUNTIME_MODE" "  "}
      (is (not (config/self-hosted?)))))
  (testing "the INSTANT_ name and the SIDEKICK_ name, which wins"
    (with-env {"INSTANT_RUNTIME_MODE" "self-hosted"}
      (is (config/self-hosted?)))
    (with-env {"SIDEKICK_RUNTIME_MODE" "Self-Hosted "}
      (is (config/self-hosted?)))
    (with-env {"SIDEKICK_RUNTIME_MODE" "default"
               "INSTANT_RUNTIME_MODE" "self-hosted"}
      (is (not (config/self-hosted?))))))

(deftest invalid-settings-stop-startup
  (with-redefs [config/get-env (constantly :dev)]
    (with-env {"SIDEKICK_RUNTIME_MODE" "selfhosted"}
      (is (re-find #"SIDEKICK_RUNTIME_MODE \(or INSTANT_RUNTIME_MODE\) is \"selfhosted\""
                   (first (config/runtime-mode-errors)))))
    (with-env {"INSTANT_RUNTIME_MODE" "self-hosted"}
      (is (= [] (config/runtime-mode-errors))))
    (with-env {}
      (is (= [] (config/runtime-mode-errors)))))
  (testing "self-hosted cannot be combined with PRODUCTION or STAGING"
    (doseq [env [:prod :staging]]
      (with-redefs [config/get-env (constantly env)]
        (with-env {"INSTANT_RUNTIME_MODE" "self-hosted"}
          (is (re-find #"cannot be combined" (first (config/runtime-mode-errors)))))
        (with-env {"INSTANT_RUNTIME_MODE" "default"}
          (is (= [] (config/runtime-mode-errors))))))))

(deftest dev-only-behaviour
  (with-redefs [config/get-env (constantly :dev)]
    (with-env {} (is (config/dev-only?)))
    (with-env {"INSTANT_RUNTIME_MODE" "default"} (is (config/dev-only?)))
    (with-env {"INSTANT_RUNTIME_MODE" "self-hosted"} (is (not (config/dev-only?)))))
  (with-redefs [config/get-env (constantly :prod)]
    (with-env {} (is (not (config/dev-only?))))))

(deftest startup-errors
  (testing "a self-hosted or misconfigured :dev server exits; upstream :dev keeps running"
    (with-redefs [config/get-env (constantly :dev)]
      (with-env {} (is (not (config/exit-on-startup-error?))))
      (with-env {"INSTANT_RUNTIME_MODE" "default"} (is (not (config/exit-on-startup-error?))))
      (with-env {"INSTANT_RUNTIME_MODE" "self-hosted"} (is (config/exit-on-startup-error?)))
      (with-env {"INSTANT_RUNTIME_MODE" "typo"} (is (config/exit-on-startup-error?)))))
  (testing "outside :dev it always exits, as before"
    (with-redefs [config/get-env (constantly :prod)]
      (with-env {} (is (config/exit-on-startup-error?))))))

(deftest secure-cookies
  (testing "default mode: Secure outside :dev, as before"
    (with-env {}
      (with-redefs [config/get-env (constantly :dev)]
        (is (not (config/secure-cookies?))))
      (with-redefs [config/get-env (constantly :prod)]
        (is (config/secure-cookies?)))))
  (testing "self-hosted: Secure when the backend URL is https"
    (with-env {"INSTANT_RUNTIME_MODE" "self-hosted"}
      (with-redefs [config/get-env (constantly :dev)]
        (with-redefs [config/server-origin "https://api.example.com"]
          (is (config/secure-cookies?)))
        (with-redefs [config/server-origin "HTTPS://api.example.com"]
          (is (config/secure-cookies?)))
        (with-redefs [config/server-origin "http://localhost:8888"]
          (is (not (config/secure-cookies?))))))))

(deftest nrepl
  (with-env {} (is (config/nrepl-enabled?)))
  (with-env {"INSTANT_RUNTIME_MODE" "self-hosted"} (is (not (config/nrepl-enabled?))))
  (with-env {"INSTANT_RUNTIME_MODE" "self-hosted" "SIDEKICK_NREPL" "true"}
    (is (config/nrepl-enabled?))))

(def gated-steps #{:sunset :app-proxy :join-room-logger :hint-testing})

(deftest skipped-startup-steps
  (is (= gated-steps core/self-hosted-skipped-init-steps))
  (testing "default mode skips nothing"
    (with-env {}
      (doseq [step (conj gated-steps :nrepl :wal :web-server)]
        (is (not (core/skip-init-step? step)) (str step)))))
  (testing "self-hosted skips the gated steps and nREPL, and nothing else"
    (with-env {"INSTANT_RUNTIME_MODE" "self-hosted"}
      (doseq [step gated-steps]
        (is (core/skip-init-step? step) (str step)))
      (is (core/skip-init-step? :nrepl))
      (doseq [step [:wal :invalidator :aggregator :grpc-server :ephemeral
                    :webhook-processor :app-backup-jobs :storage-sweeper
                    :triples-size-updates :web-server]]
        (is (not (core/skip-init-step? step)) (str step)))))
  (testing "self-hosted with INSTANT_NREPL=true starts nREPL"
    (with-env {"INSTANT_RUNTIME_MODE" "self-hosted" "INSTANT_NREPL" "true"}
      (is (not (core/skip-init-step? :nrepl))))))

;; Every startup step in core.clj was reviewed for the self-hosted mode. The
;; set of step names is recorded as a count and a SHA-256 of the sorted
;; names, so a step that upstream adds or removes fails this test and gets a
;; decision: add it to core/self-hosted-skipped-init-steps or not, then
;; update the two values below.
(def reviewed-step-count 43)
(def reviewed-steps-sha256
  "ef738df6bee6c66e8965f747e0caa3c886617998324c028fa4ec5dee9e274529")

(defn- sha256 [^String s]
  (let [digest (.digest (MessageDigest/getInstance "SHA-256") (.getBytes s "UTF-8"))]
    (string/join (map #(format "%02x" (bit-and % 0xff)) digest))))

(deftest every-startup-step-was-reviewed
  (let [names (->> (slurp "src/instant/core.clj")
                   (re-seq #"\(with-log-init :([a-z-]+)")
                   (map second)
                   distinct
                   sort)]
    (is (every? #(contains? (set names) (name %)) gated-steps)
        "a gated step no longer exists in core.clj")
    (is (and (= reviewed-step-count (count names))
             (= reviewed-steps-sha256 (sha256 (string/join "," names))))
        (str "The startup steps in core.clj changed. Decide for each new step "
             "whether the self-hosted mode skips it, then record the new set: "
             (count names) " steps, sha256 "
             (sha256 (string/join "," names)) ". Steps: "
             (string/join ", " names)))))

(deftest sse-requests-are-handled-locally
  (with-redefs [config/get-env (constantly :dev)]
    (with-env {"INSTANT_RUNTIME_MODE" "self-hosted"}
      (is (every? true? (repeatedly 50 #(sse/get-handle-locally? config/machine-id)))))
    (with-env {}
      ;; Upstream dev behaviour: about half go through Hazelcast.
      (is (some false? (repeatedly 200 #(sse/get-handle-locally? config/machine-id)))))))

(deftest no-dev-server-headers
  (let [handler (fn [_] {:status 200 :headers {}})]
    (with-redefs [config/get-env (constantly :dev)]
      (with-env {"INSTANT_RUNTIME_MODE" "self-hosted"}
        (is (not (contains? (:headers ((core/wrap-dev-server-info handler) {}))
                            "X-Instant-Server-Hostname"))))
      (with-env {}
        (is (contains? (:headers ((core/wrap-dev-server-info handler) {}))
                       "X-Instant-Server-Hostname"))))))
