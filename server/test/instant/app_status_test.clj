(ns instant.app-status-test
  "SidekickDB: an app's own status (active, read-only, disabled) is enforced,
   and nothing else changes it. Upstream overlays a global wind-down stage,
   read from the `sunset-stage` flag, on every app; SidekickDB removed that."
  (:require
   [clojure.test :refer [deftest is testing]]
   [instant.fixtures :refer [with-empty-app]]
   [instant.flags :as flags]
   [instant.model.app :as app-model]
   [instant.model.instant-subscription :as instant-subscription-model]
   [instant.plans :as plans]
   [instant.util.exception :as ex]
   [instant.util.test :refer [instant-ex-data]]))

(deftest own-status-gates-reads-and-writes
  (with-empty-app
    (fn [{app-id :id}]
      (testing "a new app is active"
        (is (= :active (app-model/get-status app-id)))
        (is (nil? (app-model/assert-write-allowed! app-id)))
        (is (nil? (app-model/assert-read-allowed! app-id))))
      (testing "read-only refuses writes and allows reads"
        (app-model/set-status! {:app-id app-id :status "read-only"})
        (is (= :read-only (app-model/get-status app-id)))
        (is (= ::ex/app-read-only
               (::ex/type (instant-ex-data
                           (app-model/assert-write-allowed! app-id)))))
        (is (nil? (app-model/assert-read-allowed! app-id))))
      (testing "disabled refuses reads and writes"
        (app-model/set-status! {:app-id app-id :status "disabled"})
        (is (= :disabled (app-model/get-status app-id)))
        (is (= ::ex/app-disabled
               (::ex/type (instant-ex-data
                           (app-model/assert-write-allowed! app-id)))))
        (is (= ::ex/app-disabled
               (::ex/type (instant-ex-data
                           (app-model/assert-read-allowed! app-id))))))
      (testing "active allows both again"
        (app-model/set-status! {:app-id app-id :status "active"})
        (is (= :active (app-model/get-status app-id)))
        (is (nil? (app-model/assert-write-allowed! app-id)))
        (is (nil? (app-model/assert-read-allowed! app-id)))))))

(deftest a-sunset-stage-flag-changes-nothing
  (doseq [stage ["signups-closed" "read-only" "disabled"]]
    (testing (str "with the flag sunset-stage set to " stage)
      (binding [flags/*flag-overrides* {:sunset-stage stage}]
        (testing "an app can be created, stays active and takes writes and reads"
          (with-empty-app
            (fn [{app-id :id}]
              (is (= :active (app-model/get-status app-id)))
              (is (nil? (app-model/assert-write-allowed! app-id)))
              (is (nil? (app-model/assert-read-allowed! app-id))))))
        (testing "a free plan does not get the paid member feature"
          (is (not (instant-subscription-model/plan-supports-members?
                    {:subscription_type_id plans/FREE_SUBSCRIPTION_TYPE})))
          (is (instant-subscription-model/plan-supports-members?
               {:subscription_type_id plans/PRO_SUBSCRIPTION_TYPE})))))))
