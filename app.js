const { createApp, ref, computed, watch, onMounted, nextTick } = Vue;

createApp({
    setup() {
        const currentTab = ref('accounts');
        const syncStatus = ref('');
        const bulkBlacklistText = ref('');
        
        // Modal State
        const showPoolModal = ref(false);
        const selectedAccountIndex = ref(null);
        
        // Base de Datos
        const accounts = ref([]);
        const pool = ref([]);
        const blacklist = ref([]);

        // --- SISTEMA DE FILTRADO PARA EL POOL ---
        const filters = ref({
            search: '', // Busca en ID o Ciudad
            isp: '',    // Busca en ASN/ISP
            country: '' // Filtro exacto por país
        });
        const sortDesc = ref(true); // Controla el orden de Calidad

        const toggleSortScore = () => { sortDesc.value = !sortDesc.value; };
        
        const clearFilters = () => {
            filters.value.search = '';
            filters.value.isp = '';
            filters.value.country = '';
        };

        // Genera la lista única de países para el Dropdown basándose en lo que hay en el Pool
        const uniqueCountries = computed(() => {
            const countries = pool.value.map(n => n.country).filter(c => c && c !== 'N/A');
            return [...new Set(countries)].sort();
        });

        // Motor del Buscador en Vivo
        const filteredPool = computed(() => {
            let result = pool.value;

            // Filtro 1: Búsqueda Libre (ID o Ciudad)
            if (filters.value.search) {
                const s = filters.value.search.toLowerCase();
                result = result.filter(n => 
                    n.id.toLowerCase().includes(s) || 
                    n.city.toLowerCase().includes(s)
                );
            }

            // Filtro 2: ISP / ASN
            if (filters.value.isp) {
                const ispSearch = filters.value.isp.toLowerCase();
                result = result.filter(n => n.asn_isp.toLowerCase().includes(ispSearch));
            }

            // Filtro 3: País
            if (filters.value.country) {
                result = result.filter(n => n.country === filters.value.country);
            }

            // Ordenación Final por Score
            return result.sort((a, b) => {
                return sortDesc.value ? b.q_score - a.q_score : a.q_score - b.q_score;
            });
        });

        // Persistencia
        const saveData = () => {
            localStorage.setItem('vpnerp_accounts_v3', JSON.stringify(accounts.value));
            localStorage.setItem('vpnerp_pool_v3', JSON.stringify(pool.value));
            localStorage.setItem('vpnerp_blacklist_v3', JSON.stringify(blacklist.value));
        };

        const loadData = () => {
            const savedAccounts = JSON.parse(localStorage.getItem('vpnerp_accounts_v3'));
            if (savedAccounts && savedAccounts.length > 0) {
                accounts.value = savedAccounts;
            } else {
                const initial = [];
                for(let i = 1; i <= 28; i++) {
                    const num = i < 10 ? '0'+i : i;
                    initial.push({ name: `LON-${num}`, nodeId: '', ip: '' });
                }
                accounts.value = initial;
            }
            pool.value = JSON.parse(localStorage.getItem('vpnerp_pool_v3')) || [];
            blacklist.value = JSON.parse(localStorage.getItem('vpnerp_blacklist_v3')) || [];
        };

        watch([accounts, pool, blacklist], saveData, { deep: true });

        // --- SISTEMA UI Y MODAL ---
        const openPoolModal = (index) => {
            selectedAccountIndex.value = index;
            clearFilters(); // Limpiar filtros al abrir para ver todo
            showPoolModal.value = true;
            nextTick(() => lucide.createIcons());
        };

        const closePoolModal = () => {
            showPoolModal.value = false;
            selectedAccountIndex.value = null;
        };

        const assignNodeToAccount = (nodeId) => {
            if (selectedAccountIndex.value !== null) {
                accounts.value[selectedAccountIndex.value].nodeId = nodeId;
                accounts.value[selectedAccountIndex.value].ip = ''; 
                closePoolModal();
                showStatus('¡Nodo asignado exitosamente!');
            }
        };

        const releaseNode = (index) => {
            accounts.value[index].nodeId = '';
            accounts.value[index].ip = '';
            showStatus('Nodo liberado y disponible en Pool.');
        };

        const burnNode = (index) => {
            const acc = accounts.value[index];
            const nodeStr = (acc.nodeId || '').trim();
            const ipStr = (acc.ip || '').trim();

            if(nodeStr) {
                if(!blacklist.value.some(b => b.nodeId === nodeStr)) {
                    blacklist.value.unshift({ nodeId: nodeStr, ip: ipStr || 'Desconocida' });
                }
                accounts.value[index].nodeId = '';
                accounts.value[index].ip = '';
                showStatus('Nodo enviado a Lista Negra.');
            }
        };

        const hasCollision = (currentAccount) => {
            if (!currentAccount.ip && !currentAccount.nodeId) return false;
            return accounts.value.some(acc => {
                if (acc === currentAccount) return false;
                const curIp = (currentAccount.ip || '').trim();
                const accIp = (acc.ip || '').trim();
                const curNode = (currentAccount.nodeId || '').trim();
                const accNode = (acc.nodeId || '').trim();

                return (accIp !== '' && curIp !== '' && accIp === curIp) || 
                       (accNode !== '' && curNode !== '' && accNode === curNode);
            });
        };

        const collisionCount = computed(() => accounts.value.filter(acc => hasCollision(acc)).length);

        const addAccount = () => {
            const num = accounts.value.length + 1;
            accounts.value.push({ name: `LON-${num < 10 ? '0'+num : num}`, nodeId: '', ip: '' });
            nextTick(() => lucide.createIcons());
        };

        const removeAccount = (index) => {
            if(confirm("¿Eliminar esta cuenta del panel?")) accounts.value.splice(index, 1);
        };

        const processBulkBlacklist = () => {
            if(!bulkBlacklistText.value.trim()) return;
            const rawItems = bulkBlacklistText.value.split(/[\n,\s]+/);
            let agregados = 0;
            rawItems.forEach(item => {
                const limpio = item.trim();
                if(limpio.length >= 10) { 
                    const truncado = limpio.substring(0, 15);
                    if(!blacklist.value.some(b => b.nodeId === truncado)) {
                        blacklist.value.unshift({ nodeId: truncado, ip: 'Carga Masiva' });
                        agregados++;
                    }
                }
            });
            bulkBlacklistText.value = ''; 
            showStatus(`Bloqueados ${agregados} nodos.`);
        };

        const removeBlacklistNode = (index) => {
            blacklist.value.splice(index, 1);
            showStatus('Nodo perdonado. Volverá al Pool.');
        };

        // --- IMPORTACIÓN JSON ---
        const importPoolJSON = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    const rawPool = [];
                    
                    data.forEach(nodo => {
                        if (nodo.service_type !== "wireguard" || !nodo.provider_id) return;
                        
                        const idCorto = nodo.provider_id.substring(0, 15);
                        const enBlacklist = blacklist.value.some(b => b.nodeId === idCorto);
                        const enUso = accounts.value.some(a => (a.nodeId || '').trim() === idCorto);
                        
                        if (!enBlacklist && !enUso) {
                            rawPool.push({
                                id: idCorto,
                                country: nodo.location?.country || 'N/A',
                                city: nodo.location?.city || 'N/A',
                                asn_isp: `${nodo.location?.asn || ''} - ${nodo.location?.isp || 'N/A'}`,
                                q_score: (nodo.quality?.quality || 0).toFixed(2)
                            });
                        }
                    });

                    pool.value = rawPool.sort((a, b) => b.q_score - a.q_score);
                    showStatus(`¡${pool.value.length} nodos listos!`);
                    event.target.value = null; 
                    
                } catch (err) {
                    alert("Error leyendo JSON. Verifica el archivo.");
                    event.target.value = null;
                }
            };
            reader.readAsText(file);
        };

        const copyToClipboard = async (text) => {
            try {
                await navigator.clipboard.writeText(text);
                showStatus('ID Copiado');
            } catch (err) { console.error(err); }
        };

        const exportDatabase = () => {
            const dataStr = JSON.stringify({ accounts: accounts.value, pool: pool.value, blacklist: blacklist.value }, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `VPN_Respaldo_${new Date().toISOString().slice(0,10)}.json`;
            a.click();
        };

        const showStatus = (msg) => {
            syncStatus.value = msg;
            setTimeout(() => { syncStatus.value = ''; }, 3000);
        };

        onMounted(() => {
            loadData();
            setTimeout(() => { if(window.lucide) lucide.createIcons(); }, 100);
        });

        return {
            currentTab, accounts, pool, blacklist, syncStatus, bulkBlacklistText,
            showPoolModal, selectedAccountIndex, collisionCount,
            filters, filteredPool, uniqueCountries, toggleSortScore, clearFilters,
            hasCollision, addAccount, removeAccount, releaseNode, burnNode, 
            processBulkBlacklist, removeBlacklistNode, importPoolJSON, 
            copyToClipboard, exportDatabase, openPoolModal, closePoolModal, assignNodeToAccount
        };
    }
}).mount('#app');
