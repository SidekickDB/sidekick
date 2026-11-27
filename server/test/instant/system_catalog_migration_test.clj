(ns instant.system-catalog-migration-test
  (:require
   [clojure.test :refer [deftest is]]
   [honey.sql :as hsql]
   [instant.db.model.attr :as attr-model]
   [instant.jdbc.aurora :as aurora]
   [instant.jdbc.sql :as sql]
   [instant.system-catalog :as system-catalog]
   [instant.system-catalog-migration :as system-catalog-migration]
   [next.jdbc])
  (:import
   (java.util.concurrent CountDownLatch TimeUnit)))

(defn- delete-catalog-attr! [attr-id]
  (next.jdbc/with-transaction [conn (aurora/conn-pool :write)]
    (doseq [setting ["instant.allow_system_catalog_app_attr_delete"
                     "instant.allow_system_catalog_app_ident_delete"]]
      (sql/execute! conn (hsql/format {:select [[[:set_config setting "true" true]]]})))
    (sql/execute! conn (hsql/format {:delete-from :attrs
                                     :where [:= :id attr-id]})))
  (attr-model/evict-app-id-from-cache system-catalog/system-catalog-app-id))

;; SidekickDB: two nodes starting at once must not both insert the same
;; system catalog attrs.
(deftest concurrent-boots-insert-catalog-attrs-once
  (let [attr {:id (random-uuid)
              :forward-identity [(random-uuid)
                                 "$users"
                                 (str "concurrentBoot" (System/currentTimeMillis))]
              :unique? false
              :index? false
              :required? false
              :value-type :blob
              :cardinality :one}
        real-insert attr-model/insert-multi!
        insert-calls (atom 0)
        first-insert-done (CountDownLatch. 1)
        start (CountDownLatch. 1)
        ;; The first insert stays uncommitted for a second, so the other
        ;; node gets to its insert while the first one is still in flight.
        slow-insert (fn [conn app-id attrs opts]
                      (if (= 1 (swap! insert-calls inc))
                        (next.jdbc/with-transaction [tx conn]
                          (let [res (real-insert tx app-id attrs opts)]
                            (.countDown first-insert-done)
                            (Thread/sleep 1000)
                            res))
                        (do (.await first-insert-done 10 TimeUnit/SECONDS)
                            (real-insert conn app-id attrs opts))))
        boot (fn []
               (future
                 (.await start)
                 (try
                   (system-catalog-migration/ensure-attrs-on-system-catalog-app)
                   :ok
                   (catch Exception e
                     (ex-message e)))))]
    (try
      (with-redefs [system-catalog/all-attrs (conj (vec system-catalog/all-attrs) attr)
                    attr-model/insert-multi! slow-insert]
        (let [nodes [(boot) (boot)]]
          (.countDown start)
          (is (= [:ok :ok] (mapv #(deref % 30000 :timeout) nodes)))
          (is (= 1 @insert-calls))))
      (is (attr-model/seek-by-id (:id attr)
                                 (attr-model/get-by-app-id*
                                  (aurora/conn-pool :read)
                                  system-catalog/system-catalog-app-id)))
      (finally
        (delete-catalog-attr! (:id attr))))))
