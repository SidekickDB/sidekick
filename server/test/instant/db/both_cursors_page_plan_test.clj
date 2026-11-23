(ns instant.db.both-cursors-page-plan-test
  "Pins the plan shape from upstream PR #2815: when a page is bounded by both
  `after` and `before`, the where-clause join ctes are materialized, so the
  planner can't drive the query from the (closed, badly estimated) range scan.
  `instant.db.instaql-test/pagination-with-both-cursors-and-a-where-clause`
  covers the results; this covers the materialization itself."
  (:require [clojure.test :refer [deftest is testing]]
            [instant.db.attr-sketch :as cms]
            [instant.db.datalog :as d]
            [instant.db.instaql :as iq]
            [instant.db.model.attr :as attr-model]
            [instant.util.instaql :as instaql-util]))

(def app-id #uuid "5c0b6c64-6b8e-4a39-9d8c-2f2a1d3b4e01")
(def value-attr-id (java.util.UUID. 0 3))

(def attrs
  (attr-model/wrap-attrs
   (mapv (fn [n field]
           {:id (java.util.UUID. 0 n)
            :forward-identity [(java.util.UUID. 1 n) "etype" field]
            :value-type :blob
            :cardinality :one
            :index? true
            :unique? (not= field "group")
            :checked-data-type :string})
         [1 2 3] ["id" "group" "value"])))

(defn cursor [n value]
  [(java.util.UUID. 9 n) value-attr-id value 0])

(defn compile-query [q]
  (let [ctx {:app-id app-id
             :attrs attrs
             :query-normalized (instaql-util/normalized-forms q)
             :sketches (into {} (map (fn [a]
                                       [{:app-id app-id :attr-id (:id a)}
                                        {:sketch (assoc (cms/make-sketch) :total 240000)}])
                                     attrs))}
        patterns (:patterns (iq/instaql-query->patterns ctx q))
        named (d/annotate-with-hints-impl ctx {} (d/nested->named-patterns patterns))]
    (binding [d/*enable-pg-hints* true]
      (:query (d/nested-match-query ctx :m- app-id named)))))

(defn where-cte-materialization
  "Returns the materialization flag of the cte that matches the
  `group` where clause."
  [query]
  (let [group-attr-id (java.util.UUID. 0 2)
        matches (filter (fn [[_ q]]
                          (some #{group-attr-id} (flatten (seq (:where q)))))
                        (:with query))]
    (assert (= 1 (count matches))
            (str "expected one cte for the where clause, got " (count matches)))
    (nth (first matches) 2)))

(defn page-query [page-opts]
  {:etype {:$ (merge {:where {:group "x"}
                      :order {:value :asc}}
                     page-opts)}})

(deftest both-cursors-materialize-the-where-cte
  (testing "a page bounded by both cursors materializes the where cte"
    (is (= :materialized
           (where-cte-materialization
            (compile-query (page-query {:after (cursor 1 "1")
                                        :before (cursor 5 "5")}))))))

  (testing "a single-cursor page still inlines it"
    (is (= :not-materialized
           (where-cte-materialization
            (compile-query (page-query {:after (cursor 1 "1")})))))
    (is (= :not-materialized
           (where-cte-materialization
            (compile-query (page-query {:before (cursor 5 "5")})))))))
