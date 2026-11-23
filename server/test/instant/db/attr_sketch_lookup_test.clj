(ns instant.db.attr-sketch-lookup-test
  (:require
   [clojure.test :refer [deftest is]]
   [instant.db.attr-sketch :as cms]
   [instant.jdbc.aurora :as aurora])
  (:import
   (java.util.concurrent CountDownLatch ForkJoinWorkerThread TimeUnit)))

(deftest lookup-loads-misses-concurrently-off-the-common-pool
  ;; lookup-cache's loader is a blocking query. Without its own executor,
  ;; Caffeine runs it on ForkJoinPool/commonPool, whose parallelism is
  ;; availableProcessors - 1: one worker on a 2-CPU host. There, every
  ;; sketch miss in the JVM queues behind the one in flight, including one
  ;; waiting up to Hikari's connectionTimeout for a read connection.
  ;;
  ;; Each load below waits for the other to start, so they need two threads
  ;; at once; on a single worker the first one gives up after 5 seconds.
  (let [started (CountDownLatch. 2)
        loader-threads (atom [])
        k1 {:app-id (random-uuid) :attr-id (random-uuid)}
        k2 {:app-id (random-uuid) :attr-id (random-uuid)}]
    (with-redefs [cms/lookup* (fn [_conn _keys]
                                (swap! loader-threads conj (Thread/currentThread))
                                (.countDown started)
                                (if (.await started 5 TimeUnit/SECONDS)
                                  {}
                                  (throw (ex-info "sketch lookups ran one at a time" {}))))]
      (let [f1 (future (cms/lookup (aurora/conn-pool :read) [k1]))
            f2 (future (cms/lookup (aurora/conn-pool :read) [k2]))]
        ;; Neither key has a sketch, so each maps to nil.
        (is (= {k1 nil} (deref f1 10000 :timeout)))
        (is (= {k2 nil} (deref f2 10000 :timeout)))
        (is (= 2 (count @loader-threads)))
        (is (not-any? #(instance? ForkJoinWorkerThread %) @loader-threads)
            (str "loaders ran on " (mapv #(.getName ^Thread %) @loader-threads)))))))
